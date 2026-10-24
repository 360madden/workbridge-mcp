#!/usr/bin/env node
// One replay-safe UIA button action on the disposable .NET desktop probe.
// No global mouse, keyboard, foreground activation or production-VM input.
import { open, mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopUiError, executeReadOnly, parseRequest, runWinapp } from './desktop-ui.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ROOT = path.join(repo, '.tools', 'desktop-evidence');
const PROBE_PROCESS = 'DesktopProbe';
const PROBE_TITLE = 'Workbridge GUI-004 Native Input Probe';
const BUTTON_SELECTOR = 'IncrementButton';

function fail(code, message) {
  throw new DesktopUiError(code, message);
}

export function parseActionRequest(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        'request-id': { type: 'string' },
        'expected-count': { type: 'string' },
      },
    }));
  } catch {
    fail('INVALID_ARGUMENTS', 'Required: --pid --hwnd --request-id --expected-count');
  }
  const target = parseRequest([
    'inspect',
    '--pid',
    values.pid ?? '',
    '--hwnd',
    values.hwnd ?? '',
    '--process',
    PROBE_PROCESS,
    '--title',
    PROBE_TITLE,
    '--depth',
    '2',
  ]);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(values['request-id'] ?? '')) {
    fail('INVALID_REQUEST_ID', 'Invalid durable action ID');
  }
  if (!/^(0|[1-9][0-9]?)$/.test(values['expected-count'] ?? '')) {
    fail('INVALID_EXPECTED_STATE', 'expected-count must be 0-99');
  }
  return { target, requestId: values['request-id'], expectedCount: Number(values['expected-count']) };
}

function flatten(elements, out = []) {
  for (const item of elements ?? []) {
    out.push(item);
    flatten(item.children, out);
  }
  return out;
}

export function assertProbeActionReady(preflight) {
  if (
    preflight.target.process !== PROBE_PROCESS ||
    preflight.target.title !== PROBE_TITLE ||
    preflight.target.width < 300 ||
    preflight.target.height < 200
  ) {
    fail('STALE_TARGET', 'Selected window is not the visible disposable DesktopProbe');
  }
  const window = preflight.tree.windows.find((w) => Number(w.hwnd) === preflight.target.hwnd);
  const matches = flatten(window?.elements).filter((e) => e.selector === BUTTON_SELECTOR);
  if (
    matches.length !== 1 ||
    matches[0].type !== 'Button' ||
    !matches[0].isEnabled ||
    matches[0].isOffscreen ||
    !matches[0].isInvokable
  ) {
    fail('ACTION_NOT_READY', 'Expected enabled IncrementButton was not uniquely found');
  }
  return preflight.target;
}

async function readProbeCount(root, pid) {
  const filename = path.join(root, 'native-probe-' + pid + '.jsonl');
  const raw = await readFile(filename, 'utf8');
  if (raw.length > 64 * 1024) fail('PROBE_RECORD_TOO_LARGE', 'Native probe event log exceeds 64 KiB');
  const lines = raw.trim().split(/\r?\n/);
  let latest;
  for (const line of lines) {
    const event = JSON.parse(line);
    if (event.pid !== pid) fail('PROBE_IDENTITY_CHANGED', 'Probe event PID mismatch');
    if (['shown', 'incremented', 'reset'].includes(event.stage)) latest = event;
  }
  if (!latest || !Number.isInteger(latest.counter))
    fail('PROBE_NOT_READY', 'No native probe counter evidence');
  return latest;
}

async function readReceipt(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('ACTION_RECOVERY_REQUIRED', 'Action receipt is unreadable');
  }
}

export async function invokeProbeOnce(request, { runner = runWinapp, root = DEFAULT_ROOT } = {}) {
  await mkdir(root, { recursive: true });
  const base = 'ui-action-' + request.requestId;
  const receiptPath = path.join(root, base + '.json');
  const intentPath = path.join(root, base + '.intent.json');
  const lockPath = path.join(root, 'desktop-input-turn.lock');
  const previous = await readReceipt(receiptPath);
  if (previous) {
    if (
      previous.pid !== request.target.pid ||
      previous.hwnd !== request.target.hwnd ||
      previous.expectedCount !== request.expectedCount
    ) {
      fail('REQUEST_ID_CONFLICT', 'Action ID belongs to another target or expected state');
    }
    return { ok: true, replayed: true, ...previous };
  }
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('UI_TURN_BUSY', 'Another desktop input turn or orphaned lock exists');
    throw error;
  }
  try {
    if ((await readReceipt(receiptPath)) || (await readReceipt(intentPath))) {
      fail('ACTION_RECOVERY_REQUIRED', 'Previous action has a receipt or an unfinished intent');
    }
    const preflight = await executeReadOnly(request.target, runner);
    const target = assertProbeActionReady(preflight);
    const before = await readProbeCount(root, target.pid);
    if (before.counter !== request.expectedCount) {
      fail('EXPECTED_STATE_MISMATCH', 'Probe counter differs from the expected value');
    }
    const current = JSON.parse(await runner(['ui', 'list-windows', '-a', String(target.pid), '--json']));
    if (
      !Array.isArray(current) ||
      !current.some(
        (w) =>
          Number(w.hwnd) === target.hwnd &&
          Number(w.processId) === target.pid &&
          String(w.processName) === target.process &&
          String(w.title ?? '') === target.title &&
          String(w.className) === target.className,
      )
    ) {
      fail('STALE_TARGET', 'Window identity changed immediately before the action');
    }
    const intent = {
      schemaVersion: 1,
      requestId: request.requestId,
      pid: target.pid,
      hwnd: target.hwnd,
      expectedCount: request.expectedCount,
      selector: BUTTON_SELECTOR,
      startedUtc: new Date().toISOString(),
    };
    await writeFile(intentPath, JSON.stringify(intent) + '\n', { flag: 'wx' });
    let result;
    try {
      result = JSON.parse(
        await runner([
          'ui',
          'invoke',
          BUTTON_SELECTOR,
          '-w',
          String(target.hwnd),
          '--action',
          'invoke',
          '--json',
        ]),
      );
    } catch {
      fail('ACTION_RECOVERY_REQUIRED', 'UIA action result is uncertain; inspect intent and probe counter');
    }
    if (Number(result.hwnd) !== target.hwnd || result.performedAction !== 'invoke') {
      fail('ACTION_RECOVERY_REQUIRED', 'WinApp reported an unexpected action result');
    }
    let observed = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      observed = await readProbeCount(root, target.pid);
      if (
        observed.stage === 'incremented' &&
        observed.counter === before.counter + 1 &&
        Date.parse(observed.utc) >= Date.parse(intent.startedUtc)
      )
        break;
      await delay(100);
    }
    if (
      !observed ||
      observed.counter !== before.counter + 1 ||
      observed.stage !== 'incremented' ||
      !(Date.parse(observed.utc) >= Date.parse(intent.startedUtc))
    ) {
      fail('ACTION_RECOVERY_REQUIRED', 'No matching independent counter change; do not repeat blindly');
    }
    const receipt = {
      ...intent,
      completedUtc: new Date().toISOString(),
      afterCount: observed.counter,
      action: 'invoke',
      inputMethod: 'UIAutomation.InvokePattern',
      osMouseKeyboardInjected: false,
    };
    await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
    return { ok: true, replayed: false, ...receipt };
  } finally {
    await lock.close();
    await unlink(lockPath);
  }
}

async function main() {
  try {
    const request = parseActionRequest(process.argv.slice(2));
    process.stdout.write(JSON.stringify(await invokeProbeOnce(request)) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: {
          code: error instanceof DesktopUiError ? error.code : 'UNEXPECTED_FAILURE',
          message: String(error.message).slice(0, 600),
        },
      }) + '\n',
    );
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
