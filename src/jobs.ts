import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, mkdir, open, opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Workspace } from './workspace.js';
import { BridgeError, limits } from './core.js';
import { atomicWrite, digest, Serial } from './changes.js';
import { executableFor } from './command-executable.js';
import { rootsFile, rootsLock } from './roots-config.js';
import { fingerprint } from './text.js';
import { readCommandResult, invalidCommandResult, type CommandResult } from './command-result.js';

type Command = { executable: string; args: string[]; timeoutSeconds?: number };
type Profiles = { projects: Record<string, Record<string, Command>> };
type Job = {
  id: string;
  project: string;
  command: string;
  request: string;
  status: 'running' | 'passed' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted';
  startedAt: string;
  endedAt?: string;
  exitCode: number | null;
  output: string;
  outputTruncated: boolean;
  error?: string;
  errorCode?: string;
  mode?: 'profile' | 'terminal';
  executable?: string;
  timeoutSeconds?: number;
  stdout?: string;
  stderr?: string;
};
export const MAX_CONCURRENT_JOBS = 36;
const outputLimit = 1024 * 1024;
// Retained combined/separate streams can expand substantially when JSON-escaped.
export const jobRecordBytes = 16 * 1024 * 1024;
export const jobStatuses = ['running', 'passed', 'failed', 'cancelled', 'timed_out', 'interrupted'] as const;
// All persisted-job callers share this validation. Unknown legacy fields are stripped, not rewritten.
const storedJob = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
  project: z.string().min(1).max(4096),
  command: z.string().max(4096),
  request: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(jobStatuses),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().optional(),
  exitCode: z.number().int().nullable(),
  output: z.string().max(outputLimit),
  outputTruncated: z.boolean(),
  error: z.string().max(4096).optional(),
  errorCode: z.string().max(200).optional(),
  mode: z.enum(['profile', 'terminal']).optional(),
  executable: z.string().max(4096).optional(),
  timeoutSeconds: z.number().int().min(1).max(600).optional(),
  stdout: z.string().max(outputLimit).optional(),
  stderr: z.string().max(outputLimit).optional(),
});
export class Jobs {
  private live = new Map<
    string,
    {
      job: Job;
      cancel: () => void;
      done: Promise<void>;
      pending?: { result: Job; beforeHash: string };
    }
  >();
  private serial = new Serial();
  private closing = false;
  constructor(
    private workspace: Workspace,
    private stateDirectory: string,
  ) {
    workspace.protect(stateDirectory);
  }
  /**
   * Join the updater's exclusive Windows file-share lock until a new job is
   * durably recorded and visible in this.live. An updater that acquires the
   * lock first blocks admissions; one that acquires it afterward can safely
   * inspect occupied slots before stopping the service.
   */
  private async acquireAdmissionLock() {
    const lockFile = path.join(this.stateDirectory, 'updater.lock');
    // Test/CLI owners create job storage lazily; the live server already has
    // this directory. Never let a redirected state directory own the lock.
    try {
      await mkdir(this.stateDirectory, { recursive: true });
      const directory = await lstat(this.stateDirectory);
      if (!directory.isDirectory() || directory.isSymbolicLink())
        throw new BridgeError('JOB_ADMISSION_LOCK', 'Job state must be a regular directory.');
    } catch {
      throw new BridgeError(
        'JOB_ADMISSION_LOCK',
        'Cannot prepare the updater lock directory; no command was started.',
      );
    }
    let handle;
    try {
      handle = await open(lockFile, 'a+');
    } catch (error) {
      if (['EACCES', 'EPERM', 'EBUSY'].includes((error as NodeJS.ErrnoException).code ?? ''))
        throw new BridgeError(
          'SERVER_UPDATING',
          'The updater owns or blocks the command-admission lock. Inspect update status and retry after maintenance.',
        );
      throw new BridgeError('JOB_ADMISSION_LOCK', 'Cannot verify the updater lock; no command was started.');
    }
    try {
      // A lock must be a regular named file, never a redirected filesystem link.
      const [named, opened] = await Promise.all([lstat(lockFile), handle.stat()]);
      if (
        !named.isFile() ||
        named.isSymbolicLink() ||
        !opened.isFile() ||
        named.dev !== opened.dev ||
        named.ino !== opened.ino
      )
        throw new BridgeError('JOB_ADMISSION_LOCK', 'Updater lock is not a stable regular file.');
      return handle;
    } catch (error) {
      await handle.close();
      if (error instanceof BridgeError) throw error;
      throw new BridgeError('JOB_ADMISSION_LOCK', 'Cannot inspect the updater lock; no command was started.');
    }
  }
  private jobFile(id: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new BridgeError('INVALID_JOB_ID', 'Invalid job ID.');
    return path.join(this.stateDirectory, 'jobs', `${id}.json`);
  }
  private async jobDirectory() {
    try {
      const info = await lstat(path.join(this.stateDirectory, 'jobs'));
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('not a regular directory');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new BridgeError('UNREADABLE_JOB_RECORD', 'Job storage must use a regular directory, not a link.');
    }
  }
  private async save(job: Job, exclusive = false, expectedHash?: string) {
    const file = this.jobFile(job.id),
      data = JSON.stringify(job);
    for (let attempt = 0; ; attempt++) {
      // Publication may replace only the original job intent, or acknowledge exact final bytes.
      // Recheck before every retry; missing or changed storage is not implicitly repaired.
      if (expectedHash !== undefined) {
        const current = await this.readStored(job.id);
        if (current?.sha256 === digest(data)) return 'already_saved' as const;
        if (!current || current.sha256 !== expectedHash)
          throw new BridgeError(
            'JOB_SAVE_CONFLICT',
            'Saved job bytes changed or disappeared. The retained result was not discarded and no command was rerun.',
          );
      }
      // Every publication attempt rechecks storage. Never retry a command or exclusive creation.
      await this.jobDirectory();
      await mkdir(path.join(this.stateDirectory, 'jobs'), { recursive: true });
      if (!(await this.jobDirectory()))
        throw new BridgeError('UNREADABLE_JOB_RECORD', 'Job storage disappeared.');
      try {
        const entry = await lstat(file);
        if (!entry.isFile() || entry.isSymbolicLink())
          throw new BridgeError('UNREADABLE_JOB_RECORD', 'Job metadata must be a regular file, not a link.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      try {
        await atomicWrite(file, data, exclusive);
        return 'saved' as const;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (exclusive || attempt >= 9 || !['EPERM', 'EACCES', 'EBUSY'].includes(code ?? '')) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, 25 * 2 ** attempt)));
      }
    }
  }
  /** Initial publication and explicit recovery share the same before/after checks. */
  private async saveResult(result: Job, beforeHash: string) {
    const publication = await this.save(result, false, beforeHash);
    const current = await this.readStored(result.id);
    if (!current || current.sha256 !== digest(JSON.stringify(result)))
      throw new BridgeError(
        'JOB_SAVE_CONFLICT',
        'Final job bytes changed during publication. This owner still retains the result.',
      );
    return publication;
  }
  private async publishResult(job: Job, finished: Job, initialHash: string) {
    try {
      await this.saveResult(finished, initialHash);
      Object.assign(job, finished);
      this.live.delete(job.id);
    } catch (error) {
      const owned = this.live.get(job.id);
      if (owned) owned.pending = { result: finished, beforeHash: initialHash };
      // A failed save must not discard either a process result or a pre-launch error.
      Object.assign(job, finished, {
        status: 'failed',
        errorCode: 'JOB_RECORD_SAVE_FAILED',
        error: `Command ended or could not start (child exit ${finished.exitCode ?? 'unknown'}), but its final record could not be saved (${(error as NodeJS.ErrnoException).code ?? 'error'}). This owner retains the result; inspect storage, then explicitly call command_retry_save with this job ID. Preserve output before restarting. The command was not rerun.`,
      });
    }
  }
  private async profiles(): Promise<Profiles> {
    try {
      const raw = await readFile(path.join(this.stateDirectory, 'commands.json'), 'utf8');
      if (raw.length > 256_000) throw new Error('size');
      return z
        .object({
          projects: z.record(
            z.string(),
            z.record(
              z.string(),
              z
                .object({
                  executable: z.string().min(1).refine(path.isAbsolute),
                  args: z.array(z.string()).max(100),
                  timeoutSeconds: z.number().int().min(1).max(600).optional(),
                })
                .strict(),
            ),
          ),
        })
        .strict()
        .parse(JSON.parse(raw));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { projects: {} };
      throw new BridgeError(
        'COMMAND_CONFIG',
        'Invalid operator-owned .local/commands.json. Inspect its schema locally; file tools cannot change this configuration.',
      );
    }
  }
  async list(project: string) {
    const directory = await this.workspace.directory(project),
      relative = this.workspace.relative(directory);
    const profiles = await this.projectProfiles(directory);
    return {
      project: relative,
      commands: Object.entries(profiles).map(([name, c]) => ({
        name,
        executable: c.executable,
        args: c.args,
        timeoutSeconds: c.timeoutSeconds ?? 120,
      })),
    };
  }
  private async projectProfiles(directory: string) {
    const profiles = await this.profiles();
    const absolute = directory.split(path.sep).join('/');
    // Existing relative profiles retain precedence; absolute keys make new
    // installation profiles independent of the chosen primary root.
    return { ...profiles.projects[absolute], ...profiles.projects[this.workspace.relative(directory)] };
  }
  async run(project: string, command: string, requestId: string = randomUUID()) {
    return this.start(project, command, requestId);
  }
  async definition(project: string, command: string) {
    const profile = (await this.projectProfiles(await this.workspace.directory(project)))[command];
    if (!profile)
      throw new BridgeError('COMMAND_NOT_CONFIGURED', 'Use commands_list to select a configured command.');
    return { ...profile, timeoutSeconds: profile.timeoutSeconds ?? 120 };
  }
  async runPinned(project: string, command: string, expected: Command, requestId: string) {
    return this.start(project, command, requestId, undefined, expected);
  }
  async terminal(cwd: string, executable: string, args: string[], timeoutSeconds: number, requestId: string) {
    return this.start(cwd, executable, requestId, { executable, args, timeoutSeconds });
  }
  private async start(
    project: string,
    command: string,
    requestId: string,
    terminal?: Command,
    expected?: Command,
  ) {
    return this.serial.run(async () => {
      if (this.closing)
        throw new BridgeError('SERVER_CLOSING', 'Server is stopping; start the command after reconnecting.');
      const cwd = await this.workspace.directory(project),
        relative = this.workspace.relative(cwd);
      const request = digest(
        JSON.stringify(
          terminal
            ? {
                mode: 'terminal',
                cwd: relative,
                executable: terminal.executable,
                args: terminal.args,
                timeoutSeconds: terminal.timeoutSeconds,
              }
            : { project: relative, command, ...(expected ? { expected } : {}) },
        ),
      );
      const old = await this.load(requestId);
      if (old) {
        if (old.request !== request)
          throw new BridgeError('ID_REUSE', 'This request ID belongs to a different command.');
        return this.summary(old);
      }
      if (this.live.size >= MAX_CONCURRENT_JOBS)
        throw new BridgeError(
          'JOB_LIMIT',
          `All ${MAX_CONCURRENT_JOBS} command slots are occupied. Inspect diagnostics and the listed job IDs; recover retained results explicitly rather than rerunning commands.`,
          { capacity: this.capacity(), nextAction: 'diagnostics' },
        );
      const profile = terminal ?? (await this.projectProfiles(cwd))[command];
      if (!profile)
        throw new BridgeError(
          'COMMAND_NOT_CONFIGURED',
          'This project/command is not configured. commands_list shows available operator-approved commands.',
        );
      if (
        expected &&
        JSON.stringify({ ...profile, timeoutSeconds: profile.timeoutSeconds ?? 120 }) !==
          JSON.stringify(expected)
      )
        throw new BridgeError(
          'WORKFLOW_COMMAND_CHANGED',
          'The configured command changed. Inspect the workflow and create a new plan to adopt it.',
        );
      if (
        (!terminal && !path.isAbsolute(profile.executable)) ||
        !Array.isArray(profile.args) ||
        !profile.args.every((x) => typeof x === 'string') ||
        !Number.isFinite(profile.timeoutSeconds ?? 120)
      )
        throw new BridgeError(
          'COMMAND_CONFIG',
          'Command profiles require an absolute executable, string arguments, and a numeric timeout.',
        );
      const seconds = Math.max(1, Math.min(600, profile.timeoutSeconds ?? 120));
      const job: Job = {
        id: requestId,
        request,
        project: relative,
        command,
        status: 'running',
        startedAt: new Date().toISOString(),
        exitCode: null,
        output: '',
        outputTruncated: false,
        stdout: '',
        stderr: '',
        mode: terminal ? 'terminal' : 'profile',
        executable: profile.executable,
        timeoutSeconds: seconds,
      };
      const initialHash = digest(JSON.stringify(job));
      // Do not let an updater begin its idle check between durable publication
      // and in-memory ownership. The exclusive updater lock spans backup/stop.
      const admission = await this.acquireAdmissionLock();
      let resolveDone!: () => void;
      let finalizing = false;
      let kill = () => {};
      try {
        await this.save(job, true);
        // Own every admitted request, including executable resolution and final publication.
        const done = new Promise<void>((resolve) => {
          resolveDone = resolve;
        });
        this.live.set(job.id, {
          job,
          done,
          cancel: () => {
            if (job.status === 'running' && !finalizing) {
              job.status = 'cancelled';
              kill();
            }
          },
        });
      } finally {
        await admission.close();
      }
      const stopped = () => job.status === 'cancelled' || this.closing;
      const endBeforeLaunch = async (error?: unknown, code = 'COMMAND_LAUNCH_FAILED') => {
        finalizing = true;
        const finished: Job = {
          ...job,
          status: stopped() ? 'cancelled' : 'failed',
          endedAt: new Date().toISOString(),
        };
        if (finished.status === 'failed') {
          finished.errorCode = error instanceof BridgeError ? error.code : code;
          finished.error =
            error instanceof BridgeError
              ? error.message
              : `Command could not be prepared or launched (${(error as NodeJS.ErrnoException)?.code ?? 'error'}). No command process was started.`;
        }
        try {
          await this.publishResult(job, finished, initialHash);
        } finally {
          resolveDone();
        }
        return this.summary(job);
      };
      let launch: Command;
      try {
        launch = terminal ? await executableFor(profile.executable, profile.args, cwd) : profile;
        job.executable = launch.executable;
      } catch (error) {
        return endBeforeLaunch(error, 'EXECUTABLE_ERROR');
      }
      if (stopped()) return endBeforeLaunch();
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(CONTROL_PLANE_API_KEY|WORKBRIDGE_.*|GIT_.*)$/i.test(key),
        ),
      );
      const resultFile = this.jobFile(job.id).replace(/\.json$/, '.result.json');
      const resultIdentity = { jobId: job.id, invocationId: randomUUID() };
      try {
        await lstat(resultFile);
        return endBeforeLaunch(
          new BridgeError(
            'COMMAND_RESULT_EXISTS',
            'An earlier result already exists for this job ID. Inspect its history; no command was started or result overwritten.',
          ),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          return endBeforeLaunch(error, 'COMMAND_SETUP_FAILED');
      }
      try {
        await open(rootsLock(this.stateDirectory), 'wx')
          .then((handle) => handle.close())
          .catch((error: NodeJS.ErrnoException) => {
            if (error.code !== 'EEXIST') throw error;
          });
      } catch (error) {
        return endBeforeLaunch(error, 'COMMAND_SETUP_FAILED');
      }
      if (stopped()) return endBeforeLaunch();
      const worker = fileURLToPath(new URL('./command-worker.js', import.meta.url));
      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn(
          process.platform === 'win32'
            ? fileURLToPath(new URL('./command-host.exe', import.meta.url))
            : process.execPath,
          process.platform === 'win32'
            ? [process.execPath, worker, rootsLock(this.stateDirectory)]
            : [worker],
          {
            cwd,
            env,
            windowsHide: true,
            shell: false,
            detached: process.platform !== 'win32',
            stdio: ['pipe', 'pipe', 'pipe'],
          },
        );
      } catch (error) {
        return endBeforeLaunch(error, 'COMMAND_LAUNCH_FAILED');
      }
      child.stdin.on('error', () => {});
      const input = JSON.stringify({
        executable: launch.executable,
        args: launch.args,
        resultFile,
        ...resultIdentity,
        timeoutSeconds: seconds,
        rootsFile: rootsFile(this.workspace.configuration?.state ?? this.stateDirectory),
        rootsFingerprint: this.workspace.configuration?.fingerprint,
      });
      if (process.platform === 'win32') child.stdin.write(input + '\n');
      else child.stdin.end(input);
      const decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
      const append = (text: string, stream: 'stdout' | 'stderr') => {
        const room = outputLimit - job.output.length;
        const captured = text.slice(0, Math.max(0, room));
        job.output += captured;
        job[stream] = (job[stream] ?? '') + captured;
        if (text.length > room) job.outputTruncated = true;
      };
      child.stdout.on('data', (data) => append(decoders[0]!.write(data), 'stdout'));
      child.stderr.on('data', (data) => append(decoders[1]!.write(data), 'stderr'));
      kill = () => {
        if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
        if (process.platform === 'win32') child.kill();
        else {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }
      };
      child.once('exit', () => {
        if (process.platform !== 'win32' && child.pid) {
          try {
            process.kill(-child.pid, 'SIGKILL');
          } catch {}
        }
      });
      const timer = setTimeout(() => {
        if (job.status === 'running') {
          job.status = 'timed_out';
          kill();
        }
      }, seconds * 1000);
      timer.unref();
      const finish = async (code: number | null, error?: Error) => {
        finalizing = true;
        clearTimeout(timer);
        append(decoders[0]!.end(), 'stdout');
        append(decoders[1]!.end(), 'stderr');
        let result: CommandResult | undefined;
        let resultError: BridgeError | undefined;
        try {
          result = await readCommandResult(resultFile, resultIdentity);
          // A claimed successful child also requires a successful command host.
          if (result.exitCode === 0 && !result.errorCode && !result.timedOut && code !== 0)
            throw invalidCommandResult();
        } catch (error) {
          result = undefined;
          resultError = error instanceof BridgeError ? error : invalidCommandResult();
        }
        // Keep the public live job non-successful until the final record is published.
        const finished: Job = { ...job };
        if (finished.status === 'running') {
          finished.status = result?.timedOut
            ? 'timed_out'
            : result?.exitCode === 0 && !result.errorCode && !error
              ? 'passed'
              : 'failed';
        }
        finished.exitCode = result?.exitCode ?? null;
        finished.endedAt = new Date().toISOString();
        if (error)
          finished.error = `Could not start command host (${(error as NodeJS.ErrnoException).code ?? 'error'}).`;
        else if (resultError && finished.status === 'failed') {
          finished.errorCode = resultError.code;
          finished.error = resultError.message;
        } else if (result?.errorCode) {
          finished.errorCode = result.errorCode;
          finished.error = `Could not start or complete executable (${result.errorCode}).`;
        } else if (!result && finished.status === 'failed') {
          finished.error = `Command host failed before recording a result (host exit ${code ?? 'unknown'}).`;
        }
        try {
          await this.publishResult(job, finished, initialHash);
        } finally {
          resolveDone();
        }
      };
      let spawnError: Error | undefined;
      child.once('error', (error) => {
        spawnError = error;
      });
      child.once('close', (code) => {
        void finish(code, spawnError);
      });
      return this.summary(job);
    });
  }
  private summary(job: Job) {
    const { output: _output, stdout: _stdout, stderr: _stderr, request: _request, ...summary } = job;
    return {
      ...summary,
      // Terminal-looking cancellation/timeout may still own a process or final save.
      // Derive this from the current owner; never persist or trust it in old journals.
      completionPending: this.live.has(job.id) && !this.live.get(job.id)!.pending,
      outputLength: job.output.length,
      stdoutLength: job.stdout?.length ?? null,
      stderrLength: job.stderr?.length ?? null,
    };
  }
  private async readStored(id: string): Promise<{ job: Job; sha256: string } | null> {
    const file = this.jobFile(id);
    let handle;
    let observed = false;
    try {
      if (!(await this.jobDirectory())) return null;
      const entry = await lstat(file);
      observed = true;
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > jobRecordBytes)
        throw new Error('not a bounded regular file');
      handle = await open(file, 'r');
      const info = await handle.stat();
      if (!info.isFile() || info.size > jobRecordBytes || fingerprint(entry) !== fingerprint(info))
        throw new Error('changed before read');
      const bytes = Buffer.alloc(info.size + 1);
      let length = 0;
      while (length < bytes.length) {
        const read = await handle.read(bytes, length, bytes.length - length, length);
        if (!read.bytesRead) break;
        length += read.bytesRead;
      }
      const current = await lstat(file);
      if (
        length !== info.size ||
        fingerprint(info) !== fingerprint(await handle.stat()) ||
        !current.isFile() ||
        current.isSymbolicLink() ||
        fingerprint(info) !== fingerprint(current) ||
        !(await this.jobDirectory())
      )
        throw new Error('changed during read');
      const job = storedJob.parse(JSON.parse(bytes.subarray(0, length).toString('utf8')));
      if (job.id !== id) throw new Error('mismatched job identity');
      return { job, sha256: digest(bytes.subarray(0, length)) };
    } catch (error) {
      if (!observed && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw new BridgeError(
        'UNREADABLE_JOB_RECORD',
        'Saved job metadata is invalid, changed, linked, or exceeds its bounded read limit. No saved command was resumed.',
      );
    } finally {
      await handle?.close();
    }
  }
  private async load(id: string): Promise<Job | null> {
    this.jobFile(id);
    const live = this.live.get(id);
    if (live) return live.job;
    const stored = await this.readStored(id);
    if (!stored) return null;
    const job = stored.job;
    if (job.status === 'running') {
      job.status = 'interrupted';
      job.error = 'The server restarted; this job is not being resumed.';
    }
    return job;
  }
  /** Publish an owned retained result only. Never executes or reconstructs a command. */
  retrySave(id: string) {
    return this.serial.run(async () => {
      if (this.closing)
        throw new BridgeError(
          'SERVER_CLOSING',
          'Server is stopping; retained output must be preserved before restart.',
        );
      this.jobFile(id);
      const owned = this.live.get(id);
      if (!owned) {
        const stored = await this.readStored(id);
        if (!stored) throw new BridgeError('UNKNOWN_JOB', 'No such job ID.');
        if (
          ['running', 'interrupted'].includes(stored.job.status) ||
          stored.job.errorCode === 'JOB_RECORD_SAVE_FAILED'
        )
          throw new BridgeError(
            'JOB_RESULT_UNAVAILABLE',
            'This owner has no retained final result. The command was not rerun and the historical record was not rewritten.',
          );
        return {
          schemaVersion: 1 as const,
          publication: 'already_saved' as const,
          commandRerun: false as const,
          job: this.summary(stored.job),
        };
      }
      const pending = owned.pending;
      if (!pending)
        throw new BridgeError(
          'JOB_SAVE_NOT_READY',
          'The command is active or its normal publication is still in progress. Inspect command_status; no recovery was started.',
        );
      let publication: 'saved' | 'already_saved';
      try {
        publication = await this.saveResult(pending.result, pending.beforeHash);
      } catch (error) {
        if (error instanceof BridgeError) throw error;
        throw new BridgeError(
          'JOB_RECORD_SAVE_FAILED',
          'Result publication still failed. This owner retains output and its occupied job slot. Inspect storage before an explicit retry; no command was rerun.',
        );
      }
      this.live.delete(id);
      return {
        schemaVersion: 1 as const,
        publication,
        commandRerun: false as const,
        job: this.summary(pending.result),
      };
    });
  }
  async status(id: string) {
    const job = await this.load(id);
    if (!job) throw new BridgeError('UNKNOWN_JOB', 'No such job ID.');
    return this.summary(job);
  }
  async catalog(options: {
    project?: string;
    status?: Job['status'];
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
      options.limit > 100 ||
      !Number.isInteger(options.scanLimit) ||
      options.scanLimit < 1 ||
      options.scanLimit > 1000
    )
      throw new BridgeError('INVALID_JOB_PAGE', 'Use offset 0-100000, limit 1-100, and scanLimit 1-1000.');
    const deadline = Date.now() + limits.scanMs;
    const project = options.project === undefined ? null : await this.workspace.directory(options.project);
    const matches = (job: Job) =>
      (!project || path.relative(project, path.resolve(this.workspace.root, job.project)) === '') &&
      (!options.status || job.status === options.status);
    const ids = new Set<string>(this.live.keys());
    let catalogTruncated = false,
      timeLimitReached = false,
      entries = 0;
    if (await this.jobDirectory()) {
      for await (const entry of await opendir(path.join(this.stateDirectory, 'jobs'))) {
        if (++entries > limits.scanEntries || Date.now() >= deadline) {
          catalogTruncated = true;
          timeLimitReached = Date.now() >= deadline;
          break;
        }
        // Include nonregular entries with valid names so they produce an explicit issue.
        if (/^[A-Za-z0-9_-]{1,100}\.json$/.test(entry.name)) ids.add(entry.name.slice(0, -5));
      }
    }
    const ordered = [...ids].sort();
    const runningJobs = [...this.live.values()]
      .filter(({ job }) => job.status === 'running' && matches(job))
      .map(({ job }) => ({ id: job.id, project: job.project, status: job.status, startedAt: job.startedAt }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const jobs: ReturnType<Jobs['summary']>[] = [];
    const issues: { jobId: string; code: string }[] = [];
    const reserved = JSON.stringify(runningJobs).length + 1024;
    if (reserved + 256 > limits.outputChars)
      throw new BridgeError(
        'JOB_OUTPUT_LIMIT',
        'The live-job view exceeds the output budget. Narrow the project filter.',
      );
    let index = options.offset,
      scanned = 0,
      outputChars = reserved,
      outputLimitReached = false;
    while (
      index < ordered.length &&
      scanned < options.scanLimit &&
      jobs.length + issues.length < options.limit
    ) {
      if (Date.now() >= deadline) {
        timeLimitReached = true;
        break;
      }
      const id = ordered[index]!;
      scanned++;
      let summary: ReturnType<Jobs['summary']> | undefined;
      let issue: (typeof issues)[number] | undefined;
      try {
        const job = await this.load(id);
        if (!job) throw new Error('record disappeared');
        if (matches(job)) summary = this.summary(job);
      } catch {
        issue = { jobId: id, code: 'UNREADABLE_JOB_RECORD' };
      }
      let length = summary || issue ? JSON.stringify(issue ?? summary).length + 1 : 0;
      if (reserved + length > limits.outputChars) {
        summary = undefined;
        issue = { jobId: id, code: 'JOB_ENTRY_LIMIT' };
        length = JSON.stringify(issue).length + 1;
      }
      if (outputChars + length > limits.outputChars) {
        outputLimitReached = true;
        break;
      }
      index++;
      outputChars += length;
      if (issue) issues.push(issue);
      else if (summary) jobs.push(summary);
    }
    const nextOffset = index < ordered.length ? index : null;
    return {
      schemaVersion: 1 as const,
      jobs,
      // Always report the live owner's matching active jobs, even on a partial disk scan.
      runningJobs,
      nextOffset,
      scanned,
      catalogTruncated,
      scanLimitReached: scanned >= options.scanLimit && nextOffset !== null,
      outputLimitReached,
      timeLimitReached,
      issues,
      hasErrors: issues.length > 0,
      complete:
        nextOffset === null &&
        !catalogTruncated &&
        !timeLimitReached &&
        !outputLimitReached &&
        issues.length === 0,
      order: 'id-ascending' as const,
    };
  }
  async output(
    id: string,
    offset: number | undefined = undefined,
    limit = limits.outputChars,
    stream: 'combined' | 'stdout' | 'stderr' = 'combined',
    tailChars?: number,
  ) {
    if (tailChars !== undefined && offset !== undefined)
      throw new BridgeError('INVALID_ARGUMENT', 'tailChars and offset cannot be used together.');
    const job = await this.load(id);
    if (!job) throw new BridgeError('UNKNOWN_JOB', 'No such job ID.');
    const output = stream === 'combined' ? job.output : job[stream];
    if (output === undefined)
      throw new BridgeError(
        'OUTPUT_STREAM_UNAVAILABLE',
        'This legacy job only retained combined output. Request stream=combined.',
      );
    const start = tailChars === undefined ? (offset ?? 0) : Math.max(0, output.length - tailChars);
    const count = tailChars ?? limit;
    return {
      ...this.summary(job),
      offset: start,
      stream,
      streamLength: output.length,
      text: output.slice(start, start + count),
      nextOffset: start + count < output.length ? start + count : null,
    };
  }
  async cancel(id: string) {
    const live = this.live.get(id);
    if (live) {
      live.cancel();
      await live.done;
    }
    return this.status(id);
  }
  async close() {
    this.closing = true;
    await this.serial.run(async () => {});
    const jobs = [...this.live.values()];
    for (const job of jobs) job.cancel();
    await Promise.all(jobs.map((x) => x.done));
  }
  /** A bounded snapshot of this owner only; no disk access, execution or recovery. */
  private capacity() {
    const jobs = [...this.live.values()]
      .map(({ job, pending }) => ({
        jobId: job.id,
        project: job.project,
        status: job.status,
        kind: pending ? ('retained_result' as const) : ('in_progress' as const),
        nextAction: pending ? ('command_retry_save' as const) : ('command_status' as const),
      }))
      .sort((a, b) => (a.jobId < b.jobId ? -1 : a.jobId > b.jobId ? 1 : 0));
    const retainedResults = jobs.filter((job) => job.kind === 'retained_result').length;
    return {
      schemaVersion: 1 as const,
      limit: MAX_CONCURRENT_JOBS,
      occupied: jobs.length,
      available: MAX_CONCURRENT_JOBS - jobs.length,
      inProgress: jobs.length - retainedResults,
      retainedResults,
      closing: this.closing,
      jobs,
    };
  }
  async recent() {
    const directory = path.join(this.stateDirectory, 'jobs'),
      deadline = Date.now() + limits.scanMs;
    let storedJobs: number | null = 0;
    const inventory = {
      complete: true,
      scannedEntries: 0,
      limitReached: false,
      timeLimitReached: false,
      errorCode: null as string | null,
    };
    try {
      if (await this.jobDirectory()) {
        for await (const entry of await opendir(directory)) {
          inventory.limitReached = inventory.scannedEntries >= limits.scanEntries;
          inventory.timeLimitReached = Date.now() >= deadline;
          if (inventory.limitReached || inventory.timeLimitReached) {
            inventory.complete = false;
            break;
          }
          inventory.scannedEntries++;
          // Count candidate record names only; do not read or certify saved records.
          if (/^[A-Za-z0-9_-]{1,100}\.json$/.test(entry.name)) storedJobs++;
        }
      }
    } catch {
      storedJobs = null;
      inventory.complete = false;
      inventory.errorCode = 'UNREADABLE_JOB_CATALOG';
    }
    // Snapshot after the potentially slow enumeration, from the authoritative owner.
    const capacity = this.capacity();
    return {
      storedJobs,
      runningJobs: capacity.jobs.filter((job) => job.status === 'running').length,
      capacity,
      inventory,
    };
  }
}
