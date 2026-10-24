#!/usr/bin/env node
// Read-only WinApp CLI bridge. No focus, keyboard/mouse, screenshot, or VM power calls.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const PINNED_WINAPP_VERSION = '0.7.1';
const MAX_CAPTURE_BYTES = 384 * 1024;
const MAX_DIAGNOSTIC_BYTES = 8 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;

export class DesktopUiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DesktopUiError';
    this.code = code;
  }
}

function positiveInt(value, field, max = Number.MAX_SAFE_INTEGER) {
  if (!/^[1-9][0-9]*$/.test(String(value ?? ''))) {
    throw new DesktopUiError('INVALID_TARGET', `${field} must be a positive decimal integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result > max) {
    throw new DesktopUiError('INVALID_TARGET', `${field} is out of range`);
  }
  return result;
}

export function parseRequest(argv) {
  const [operation, ...tokens] = argv;
  if (!['windows', 'inspect'].includes(operation)) {
    throw new DesktopUiError('INVALID_OPERATION', 'Allowed operations: windows, inspect');
  }
  let values;
  try {
    ({ values } = parseArgs({
      args: tokens,
      strict: true,
      options: {
        app: { type: 'string' },
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        title: { type: 'string' },
        process: { type: 'string' },
        depth: { type: 'string' },
      },
    }));
  } catch {
    throw new DesktopUiError('INVALID_ARGUMENTS', 'Unknown, incomplete or repeated options');
  }
  if (operation === 'windows') {
    if (values.pid || values.hwnd || values.title || values.process || values.depth) {
      throw new DesktopUiError('INVALID_ARGUMENTS', 'windows accepts only optional --app');
    }
    if (values.app && (values.app.length > 100 || /[\r\n]/.test(values.app))) {
      throw new DesktopUiError('INVALID_ARGUMENTS', 'Invalid app filter');
    }
    return { operation, app: values.app ?? null };
  }
  if (values.app) {
    throw new DesktopUiError('INVALID_ARGUMENTS', 'inspect requires --pid and --hwnd, not --app');
  }
  const pid = positiveInt(values.pid, 'pid', 0x7fffffff);
  const hwnd = positiveInt(values.hwnd, 'hwnd');
  const depth = values.depth === undefined ? 2 : positiveInt(values.depth, 'depth', 4);
  if (values.title !== undefined && (!values.title || values.title.length > 200)) {
    throw new DesktopUiError('INVALID_ARGUMENTS', 'Invalid expected title');
  }
  if (values.process !== undefined && !/^[A-Za-z0-9_.-]{1,80}$/.test(values.process)) {
    throw new DesktopUiError('INVALID_ARGUMENTS', 'Invalid expected process name');
  }
  return { operation, pid, hwnd, depth, title: values.title ?? null, process: values.process ?? null };
}

function trimResult(value, limit) {
  return String(value ?? '').slice(0, limit);
}

export async function runWinapp(
  args,
  { executable = process.env.WORKBRIDGE_WINAPP_EXE || 'winapp.exe', timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, WINAPP_CLI_TELEMETRY_OPTOUT: '1' },
    });
    let stdout = '';
    let stderr = '';
    let overflow = false;
    let timedOut = false;
    let settled = false;
    const complete = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (Buffer.byteLength(stdout, 'utf8') > MAX_CAPTURE_BYTES) {
        overflow = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = trimResult(stderr + chunk.toString('utf8'), MAX_DIAGNOSTIC_BYTES);
    });
    child.on('error', (error) => {
      complete(
        new DesktopUiError(
          error.code === 'ENOENT' ? 'WINAPP_NOT_INSTALLED' : 'WINAPP_LAUNCH_FAILED',
          error.code === 'ENOENT'
            ? 'Install Microsoft.WinAppCli 0.7.1 before using desktop UI inspection'
            : error.message,
        ),
      );
    });
    child.on('close', (exitCode) => {
      if (timedOut)
        return complete(new DesktopUiError('WINAPP_TIMEOUT', 'WinApp CLI exceeded the 15-second deadline'));
      if (overflow)
        return complete(new DesktopUiError('OUTPUT_TOO_LARGE', 'WinApp CLI returned more than 384 KiB'));
      if (exitCode !== 0) {
        let errorCode = 'WINAPP_FAILED';
        try {
          const parsed = JSON.parse(stderr || stdout);
          errorCode = trimResult(parsed.code || parsed.error?.code || errorCode, 80);
        } catch {
          /* diagnostic only */
        }
        return complete(
          new DesktopUiError(errorCode, trimResult(stderr || stdout || 'WinApp CLI failed', 600)),
        );
      }
      complete(null, stdout);
    });
  });
}

function parseJsonOutput(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new DesktopUiError('INVALID_WINAPP_JSON', 'WinApp CLI output was not valid JSON');
  }
}

function summarizeWindow(window) {
  return {
    hwnd: window.hwnd,
    pid: window.processId,
    process: trimResult(window.processName, 100),
    title: trimResult(window.title, 200),
    className: trimResult(window.className, 100),
    width: window.width,
    height: window.height,
    isForeground: Boolean(window.isForeground),
    ownerHwnd: window.ownerHwnd ?? null,
  };
}

export async function executeReadOnly(request, runner = runWinapp) {
  const rawVersion = await runner(['--version']);
  const version = String(rawVersion).trim().split(/\s+/).at(-1);
  if (version !== PINNED_WINAPP_VERSION) {
    throw new DesktopUiError(
      'UNSUPPORTED_WINAPP_VERSION',
      `Expected WinApp CLI ${PINNED_WINAPP_VERSION}; found ${trimResult(version, 40)}`,
    );
  }
  const app = request.operation === 'windows' ? request.app : String(request.pid);
  const args = ['ui', 'list-windows', ...(app ? ['-a', app] : []), '--json'];
  const listing = parseJsonOutput(await runner(args));
  if (!Array.isArray(listing)) {
    throw new DesktopUiError('INVALID_WINAPP_JSON', 'list-windows did not return an array');
  }
  if (request.operation === 'windows') {
    return {
      schemaVersion: 1,
      readOnly: true,
      backend: 'Microsoft.WinAppCli',
      version,
      operation: 'windows',
      count: listing.length,
      truncated: listing.length > 50,
      windows: listing.slice(0, 50).map(summarizeWindow),
    };
  }
  const matched = listing.find(
    (window) => Number(window.hwnd) === request.hwnd && Number(window.processId) === request.pid,
  );
  if (!matched)
    throw new DesktopUiError('STALE_TARGET', 'PID/HWND pair was not present; rediscover the window');
  if (request.title !== null && matched.title !== request.title) {
    throw new DesktopUiError('STALE_TARGET', 'Window title changed; rediscover target');
  }
  if (
    request.process !== null &&
    String(matched.processName).toLowerCase() !== request.process.toLowerCase()
  ) {
    throw new DesktopUiError('STALE_TARGET', 'Window process name changed; rediscover target');
  }
  const tree = parseJsonOutput(
    await runner(['ui', 'inspect', '-w', String(request.hwnd), '--depth', String(request.depth), '--json']),
  );
  if (!Array.isArray(tree.windows) || !tree.windows.some((window) => Number(window.hwnd) === request.hwnd)) {
    throw new DesktopUiError('STALE_TARGET', 'UIA tree did not contain the selected HWND');
  }
  return {
    schemaVersion: 1,
    readOnly: true,
    backend: 'Microsoft.WinAppCli',
    version,
    operation: 'inspect',
    target: summarizeWindow(matched),
    tree,
  };
}

async function main() {
  try {
    const request = parseRequest(process.argv.slice(2));
    process.stdout.write(JSON.stringify({ ok: true, ...(await executeReadOnly(request)) }) + '\n');
  } catch (error) {
    const code = error instanceof DesktopUiError ? error.code : 'UNEXPECTED_FAILURE';
    process.stdout.write(
      JSON.stringify({
        ok: false,
        readOnly: true,
        error: {
          code,
          message: trimResult(error.message, 600),
        },
      }) + '\n',
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
