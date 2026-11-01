import { invokeDesktopPrototype } from './desktop-cli-runner.js';

const MAX_OUTPUT_BYTES = 512 * 1024;
const RUN_OPTIONS = { timeoutMs: 45000, maxOutputBytes: MAX_OUTPUT_BYTES };

type DesktopRunner = typeof invokeDesktopPrototype;

type InspectTarget = {
  pid: number;
  hwnd: number;
  process: string;
  title?: string;
  depth?: number;
};

function invalid(code: string, message: string): never {
  throw Object.assign(new TypeError(message), { code });
}

function positiveInteger(value: unknown, field: string, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > max) {
    invalid('INVALID_TARGET', `${field} must be a positive safe integer no greater than ${max}`);
  }
  return value;
}

function boundedText(value: unknown, field: string, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalid('INVALID_ARGUMENTS', `${field} must contain 1-${max} characters without control characters`);
  }
  return value;
}

async function run(args: readonly string[], runner: DesktopRunner): Promise<Record<string, unknown>> {
  // The CLI bounds the window list and UIA depth; retain the runner's byte/deadline limits too.
  const result = await runner('desktop-ui.mjs', args, { ...RUN_OPTIONS });
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_OUTPUT_BYTES) {
    invalid('OUTPUT_TOO_LARGE', 'Desktop metadata exceeded the 512 KiB response limit');
  }
  return result;
}

export async function desktopWindows(
  app?: string,
  runner: DesktopRunner = invokeDesktopPrototype,
): Promise<Record<string, unknown>> {
  const args = ['windows'];
  if (app !== undefined) args.push(`--app=${boundedText(app, 'app', 100)}`);
  return run(args, runner);
}

export async function desktopInspect(
  target: InspectTarget,
  runner: DesktopRunner = invokeDesktopPrototype,
): Promise<Record<string, unknown>> {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    invalid('INVALID_TARGET', 'Inspection requires a PID, HWND and process identity');
  }
  const pid = positiveInteger(target.pid, 'pid', 0x7fffffff);
  const hwnd = positiveInteger(target.hwnd, 'hwnd');
  const processName = boundedText(target.process, 'process', 80);
  if (!/^[A-Za-z0-9_.-]+$/.test(processName)) {
    invalid('INVALID_ARGUMENTS', 'process must be an exact process name');
  }
  const depth = target.depth === undefined ? 2 : positiveInteger(target.depth, 'depth', 4);
  const args = [
    'inspect',
    '--pid',
    String(pid),
    '--hwnd',
    String(hwnd),
    `--process=${processName}`,
    '--depth',
    String(depth),
  ];
  if (target.title !== undefined) args.push(`--title=${boundedText(target.title, 'title', 200)}`);
  return run(args, runner);
}
