import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The build stages these exact prototypes beside the compiled runner in dist.
// WB-001 swaps dist atomically with the release; never load mutable source scripts.
const scripts = Object.freeze({
  'desktop-ui.mjs': fileURLToPath(new URL('./desktop-ui.mjs', import.meta.url)),
  'desktop-capture.mjs': fileURLToPath(new URL('./desktop-capture.mjs', import.meta.url)),
  'vmware-host-capture.mjs': fileURLToPath(new URL('./vmware-host-capture.mjs', import.meta.url)),
  'desktop-probe-act.mjs': fileURLToPath(new URL('./desktop-probe-act.mjs', import.meta.url)),
});
type DesktopScript = keyof typeof scripts;
type InvokeOptions = { timeoutMs?: number; maxOutputBytes?: number };
type FailureCode =
  | 'DESKTOP_INVALID_ARGUMENTS'
  | 'DESKTOP_LAUNCH_FAILED'
  | 'DESKTOP_TIMEOUT'
  | 'DESKTOP_OUTPUT_LIMIT'
  | 'DESKTOP_PROCESS_FAILED'
  | 'DESKTOP_INVALID_RESPONSE'
  | 'DESKTOP_TREE_UNSETTLED';

const messages: Record<FailureCode, string> = {
  DESKTOP_INVALID_ARGUMENTS: 'Invalid desktop prototype script, arguments or execution limits.',
  DESKTOP_LAUNCH_FAILED: 'The desktop prototype could not be started.',
  DESKTOP_TIMEOUT: 'The desktop prototype exceeded its deadline; inspect existing evidence before retrying.',
  DESKTOP_OUTPUT_LIMIT: 'The desktop prototype exceeded its output limit.',
  DESKTOP_PROCESS_FAILED: 'The desktop prototype did not complete successfully; inspect local evidence.',
  DESKTOP_INVALID_RESPONSE: 'The desktop prototype returned an invalid or inconsistent JSON response.',
  DESKTOP_TREE_UNSETTLED:
    'Desktop process-tree termination is unverified; retain the GUI turn until explicit recovery.',
};

/** Deliberately excludes child output, arguments, environment and raw error causes. */
export class DesktopPrototypeError extends Error {
  readonly code: FailureCode;
  readonly interruptedBy?: FailureCode;

  constructor(code: FailureCode, interruptedBy?: FailureCode) {
    super(messages[code]);
    this.name = 'DesktopPrototypeError';
    this.code = code;
    this.interruptedBy = interruptedBy;
  }
}

function boundedInteger(value: number, min: number, max: number) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function launchEnvironment() {
  const env = { ...process.env };
  // Fixed desktop prototypes never require tunnel, model, cloud or Git credentials.
  // Keep normal Windows/WinApp paths, but deny ambient preload and auth overrides.
  for (const key of Object.keys(env)) {
    if (
      /^(NODE_OPTIONS|NODE_PATH|WORKBRIDGE_|CONTROL_PLANE_|GIT_|AWS_|AZURE_|OPENAI_|ANTHROPIC_|CODEX_|GH_|GITHUB_|GOOGLE_APPLICATION_CREDENTIALS$)/i.test(
        key,
      ) ||
      /_(TOKEN|API_KEY|SECRET|PASSWORD|CREDENTIAL)$/i.test(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

/** Injection is for offline tests; production callers use invokeDesktopPrototype. */
export function createDesktopPrototypeInvoker(spawnProcess: typeof spawn = spawn) {
  return async function invoke(
    script: DesktopScript,
    args: readonly string[],
    options: InvokeOptions = {},
  ): Promise<Record<string, unknown>> {
    const timeoutMs = options?.timeoutMs ?? 45_000;
    const maxOutputBytes = options?.maxOutputBytes ?? 512 * 1024;
    if (
      !Object.hasOwn(scripts, script) ||
      !Array.isArray(args) ||
      args.length > 64 ||
      Array.from(args).some(
        (arg) => typeof arg !== 'string' || arg.includes('\0') || Buffer.byteLength(arg) > 8192,
      ) ||
      args.reduce((total, arg) => total + Buffer.byteLength(arg), 0) > 16 * 1024 ||
      !boundedInteger(timeoutMs, 1000, 45_000) ||
      !boundedInteger(maxOutputBytes, 1, 1024 * 1024)
    ) {
      throw new DesktopPrototypeError('DESKTOP_INVALID_ARGUMENTS');
    }

    return await new Promise((resolve, reject) => {
      let child;
      try {
        child = spawnProcess(process.execPath, [scripts[script], ...args], {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: launchEnvironment(),
        });
      } catch {
        reject(new DesktopPrototypeError('DESKTOP_LAUNCH_FAILED'));
        return;
      }

      let settled = false;
      let outputBytes = 0;
      const stdout: Buffer[] = [];
      const finish = (error?: DesktopPrototypeError, result?: Record<string, unknown>, kill = false) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        // Killing only the Node wrapper cannot prove its WinApp grandchildren stopped.
        // Do not release the caller's GUI lease on an unverified forced termination.
        const failure = kill ? new DesktopPrototypeError('DESKTOP_TREE_UNSETTLED', error?.code) : error;
        if (kill) {
          try {
            child.kill('SIGKILL');
          } catch {
            /* An unsuccessful kill is also unsettled; no automatic retry. */
          }
          child.stdout.destroy();
          child.stderr.destroy();
          child.unref();
        }
        stdout.length = 0;
        if (failure) reject(failure);
        else resolve(result!);
      };
      const timer = setTimeout(
        () => finish(new DesktopPrototypeError('DESKTOP_TIMEOUT'), undefined, true),
        timeoutMs,
      );
      const collect = (chunk: Buffer, keep: boolean) => {
        if (settled) return;
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) {
          finish(new DesktopPrototypeError('DESKTOP_OUTPUT_LIMIT'), undefined, true);
        } else if (keep) stdout.push(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => collect(chunk, true));
      // Count stderr against the same bound, without retaining or exposing its contents.
      child.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
      child.stdout.on('error', () =>
        finish(new DesktopPrototypeError('DESKTOP_PROCESS_FAILED'), undefined, true),
      );
      child.stderr.on('error', () =>
        finish(new DesktopPrototypeError('DESKTOP_PROCESS_FAILED'), undefined, true),
      );
      child.on('error', () =>
        finish(
          new DesktopPrototypeError('DESKTOP_LAUNCH_FAILED'),
          undefined,
          typeof child.pid === 'number' && child.pid > 0,
        ),
      );
      child.on('close', (exitCode, signal) => {
        if (settled) return;
        if (exitCode !== 0 || signal !== null) {
          // A failed Node wrapper may have aborted a nested WinApp child before exit.
          // Without a process-tree supervisor, wrapper close alone cannot certify its descendants.
          finish(new DesktopPrototypeError('DESKTOP_TREE_UNSETTLED', 'DESKTOP_PROCESS_FAILED'));
          return;
        }
        let result: unknown;
        try {
          result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout)));
        } catch {
          finish(new DesktopPrototypeError('DESKTOP_TREE_UNSETTLED', 'DESKTOP_INVALID_RESPONSE'));
          return;
        }
        if (
          result === null ||
          typeof result !== 'object' ||
          Array.isArray(result) ||
          (result as Record<string, unknown>).ok !== true ||
          Object.hasOwn(result, 'error')
        ) {
          finish(new DesktopPrototypeError('DESKTOP_TREE_UNSETTLED', 'DESKTOP_INVALID_RESPONSE'));
          return;
        }
        finish(undefined, result as Record<string, unknown>);
      });
    });
  };
}

const invoke = createDesktopPrototypeInvoker();

export async function invokeDesktopPrototype(
  script: 'desktop-ui.mjs' | 'desktop-capture.mjs' | 'vmware-host-capture.mjs' | 'desktop-probe-act.mjs',
  args: readonly string[],
  options?: { timeoutMs?: number; maxOutputBytes?: number },
): Promise<Record<string, unknown>> {
  return await invoke(script, args, options);
}
