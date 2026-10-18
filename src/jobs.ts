import { spawn } from 'node:child_process';
import { readFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Workspace } from './workspace.js';
import { BridgeError, limits } from './core.js';
import { atomicWrite, digest, Serial } from './changes.js';
import { executableFor } from './command-executable.js';

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
const outputLimit = 1024 * 1024;
export class Jobs {
  private live = new Map<string, { job: Job; cancel: () => void; done: Promise<void> }>();
  private serial = new Serial();
  private closing = false;
  constructor(
    private workspace: Workspace,
    private stateDirectory: string,
  ) {
    workspace.protect(stateDirectory);
  }
  private jobFile(id: string) {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new BridgeError('INVALID_JOB_ID', 'Invalid job ID.');
    return path.join(this.stateDirectory, 'jobs', `${id}.json`);
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
    const profiles = await this.profiles();
    return {
      project: relative,
      commands: Object.entries(profiles.projects[relative] ?? {}).map(([name, c]) => ({
        name,
        executable: c.executable,
        args: c.args,
        timeoutSeconds: c.timeoutSeconds ?? 120,
      })),
    };
  }
  async run(project: string, command: string, requestId: string = randomUUID()) {
    return this.start(project, command, requestId);
  }
  async terminal(cwd: string, executable: string, args: string[], timeoutSeconds: number, requestId: string) {
    return this.start(cwd, executable, requestId, { executable, args, timeoutSeconds });
  }
  private async start(project: string, command: string, requestId: string, terminal?: Command) {
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
            : { project: relative, command },
        ),
      );
      const old = await this.load(requestId);
      if (old) {
        if (old.request !== request)
          throw new BridgeError('ID_REUSE', 'This request ID belongs to a different command.');
        return this.summary(old);
      }
      if (this.live.size >= 2)
        throw new BridgeError('JOB_LIMIT', 'Two command jobs are already running; wait or cancel one.');
      const profile = terminal ?? (await this.profiles()).projects[relative]?.[command];
      if (!profile)
        throw new BridgeError(
          'COMMAND_NOT_CONFIGURED',
          'This project/command is not configured. commands_list shows available operator-approved commands.',
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
      await mkdir(path.join(this.stateDirectory, 'jobs'), { recursive: true });
      await atomicWrite(this.jobFile(job.id), JSON.stringify(job), true);
      let launch: Command;
      try {
        launch = terminal ? await executableFor(profile.executable, profile.args, cwd) : profile;
        job.executable = launch.executable;
      } catch (error) {
        job.status = 'failed';
        job.endedAt = new Date().toISOString();
        job.error = error instanceof BridgeError ? error.message : 'Executable resolution failed.';
        job.errorCode = error instanceof BridgeError ? error.code : 'EXECUTABLE_ERROR';
        await atomicWrite(this.jobFile(job.id), JSON.stringify(job));
        return this.summary(job);
      }
      const env = Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(CONTROL_PLANE_API_KEY|WORKBRIDGE_.*|GIT_.*)$/i.test(key),
        ),
      );
      const resultFile = this.jobFile(job.id).replace(/\.json$/, '.result.json');
      const worker = fileURLToPath(new URL('./command-worker.js', import.meta.url));
      const child = spawn(
        process.platform === 'win32'
          ? fileURLToPath(new URL('./command-host.exe', import.meta.url))
          : process.execPath,
        process.platform === 'win32' ? [process.execPath, worker] : [worker],
        {
          cwd,
          env,
          windowsHide: true,
          shell: false,
          detached: process.platform !== 'win32',
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      child.stdin.on('error', () => {});
      const input = JSON.stringify({
        executable: launch.executable,
        args: launch.args,
        resultFile,
        timeoutSeconds: seconds,
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
      const kill = () => {
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
      let resolveDone!: () => void;
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const finish = async (code: number | null, error?: Error) => {
        clearTimeout(timer);
        append(decoders[0]!.end(), 'stdout');
        append(decoders[1]!.end(), 'stderr');
        const result = await readFile(resultFile, 'utf8')
          .then((text) =>
            z
              .object({
                exitCode: z.number().int().nullable(),
                errorCode: z.string().optional(),
                timedOut: z.boolean(),
              })
              .parse(JSON.parse(text)),
          )
          .catch(() => null);
        if (job.status === 'running') {
          job.status = result?.timedOut
            ? 'timed_out'
            : result?.exitCode === 0 && !result.errorCode && !error
              ? 'passed'
              : 'failed';
        }
        job.exitCode = result?.exitCode ?? null;
        job.endedAt = new Date().toISOString();
        if (error)
          job.error = `Could not start command host (${(error as NodeJS.ErrnoException).code ?? 'error'}).`;
        else if (result?.errorCode) {
          job.errorCode = result.errorCode;
          job.error = `Could not start or complete executable (${result.errorCode}).`;
        } else if (!result && job.status === 'failed') {
          job.error = `Command host failed before recording a result (host exit ${code ?? 'unknown'}).`;
        }
        try {
          await atomicWrite(this.jobFile(job.id), JSON.stringify(job));
        } catch {
          job.error = 'Job ended, but its final record could not be saved.';
        }
        this.live.delete(job.id);
        resolveDone();
      };
      let spawnError: Error | undefined;
      child.once('error', (error) => {
        spawnError = error;
      });
      child.once('close', (code) => {
        void finish(code, spawnError);
      });
      this.live.set(job.id, {
        job,
        cancel: () => {
          if (job.status === 'running') {
            job.status = 'cancelled';
            kill();
          }
        },
        done,
      });
      return this.summary(job);
    });
  }
  private summary(job: Job) {
    const { output: _output, stdout: _stdout, stderr: _stderr, request: _request, ...summary } = job;
    return {
      ...summary,
      outputLength: job.output.length,
      stdoutLength: job.stdout?.length ?? null,
      stderrLength: job.stderr?.length ?? null,
    };
  }
  private async load(id: string): Promise<Job | null> {
    const live = this.live.get(id);
    if (live) return live.job;
    try {
      const job = JSON.parse(await readFile(this.jobFile(id), 'utf8')) as Job;
      if (job.status === 'running') {
        job.status = 'interrupted';
        job.error = 'The server restarted; this job is not being resumed.';
      }
      return job;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }
  async status(id: string) {
    const job = await this.load(id);
    if (!job) throw new BridgeError('UNKNOWN_JOB', 'No such job ID.');
    return this.summary(job);
  }
  async output(
    id: string,
    offset = 0,
    limit = limits.outputChars,
    stream: 'combined' | 'stdout' | 'stderr' = 'combined',
  ) {
    const job = await this.load(id);
    if (!job) throw new BridgeError('UNKNOWN_JOB', 'No such job ID.');
    const output = stream === 'combined' ? job.output : job[stream];
    if (output === undefined)
      throw new BridgeError(
        'OUTPUT_STREAM_UNAVAILABLE',
        'This legacy job only retained combined output. Request stream=combined.',
      );
    return {
      ...this.summary(job),
      offset,
      stream,
      streamLength: output.length,
      text: output.slice(offset, offset + limit),
      nextOffset: offset + limit < output.length ? offset + limit : null,
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
  async recent() {
    const directory = path.join(this.stateDirectory, 'jobs');
    const names = await readdir(directory).catch(() => [] as string[]);
    return {
      storedJobs: names.filter((name) => /^[A-Za-z0-9_-]{1,100}\.json$/.test(name)).length,
      runningJobs: [...this.live.values()].filter((x) => x.job.status === 'running').length,
    };
  }
}
