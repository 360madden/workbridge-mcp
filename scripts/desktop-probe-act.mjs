#!/usr/bin/env node
// Replay-safe UIA / window-targeted keyboard / pointer trials on disposable DesktopProbe only.
// No arbitrary app or VMware guest inputs.
import { createHash, randomUUID } from 'node:crypto';
import { open, mkdir, lstat, readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { DesktopUiError, executeReadOnly, parseRequest, runWinapp } from './desktop-ui.mjs';
import { DesktopAdmissionError, withDesktopAdmission } from './desktop-turn-admission.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ROOT = path.join(repo, '.tools', 'desktop-evidence');
const PROBE_PROCESS = 'DesktopProbe';
const PROBE_TITLE = 'Workbridge GUI-004 Native Input Probe';
const BUTTON_SELECTOR = 'IncrementButton';
const execFileAsync = promisify(execFile);

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
        method: { type: 'string' },
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
  const method = values.method ?? 'uia';
  if (!['uia', 'keyboard', 'mouse'].includes(method)) {
    fail('INVALID_METHOD', 'Supported disposable-probe methods: uia, keyboard, mouse');
  }
  return { target, requestId: values['request-id'], expectedCount: Number(values['expected-count']), method };
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

// UIA sometimes reports isOffscreen:false even if a minimized window's coordinates are -32000.
export function assertProbePointerReady(preflight) {
  const target = assertProbeActionReady(preflight);
  const window = preflight.tree.windows.find((w) => Number(w.hwnd) === target.hwnd);
  const root = window?.elements?.[0];
  const matches = flatten(window?.elements).filter((e) => e.selector === BUTTON_SELECTOR);
  const button = matches[0];
  const fields = [
    root?.x,
    root?.y,
    root?.width,
    root?.height,
    button?.x,
    button?.y,
    button?.width,
    button?.height,
  ];
  if (
    fields.some((n) => !Number.isFinite(n)) ||
    root.width < 300 ||
    root.height < 200 ||
    button.width < 20 ||
    button.height < 20 ||
    Math.abs(root.x) > 20000 ||
    Math.abs(root.y) > 20000 ||
    button.x < root.x ||
    button.y < root.y ||
    button.x + button.width > root.x + root.width ||
    button.y + button.height > root.y + root.height
  ) {
    fail('TARGET_NOT_VISIBLE', 'Probe button is outside its full, unminimized window');
  }
  return {
    target,
    button,
    windowRect: { x: root.x, y: root.y, width: root.width, height: root.height },
  };
}

// Focus/activation may move or resize the fixture. The geometry used to
// authorize a later click must match both snapshots, not merely be on-screen.
function assertStableProbeGeometry(expected, observed) {
  const sameRect = (a, b) => ['x', 'y', 'width', 'height'].every((key) => a[key] === b[key]);
  if (
    observed.target.width !== expected.target.width ||
    observed.target.height !== expected.target.height ||
    !sameRect(expected.windowRect, observed.windowRect) ||
    !sameRect(expected.button, observed.button)
  ) {
    fail('TARGET_GEOMETRY_CHANGED', 'Probe geometry moved after preflight; no input sent');
  }
}

async function assertFreshTarget(target, runner, requireForeground = false, expectedGeometry = null) {
  const current = JSON.parse(await runner(['ui', 'list-windows', '-a', String(target.pid), '--json']));
  const found = Array.isArray(current)
    ? current.find(
        (w) =>
          Number(w.hwnd) === target.hwnd &&
          Number(w.processId) === target.pid &&
          String(w.processName) === target.process &&
          String(w.title ?? '') === target.title &&
          String(w.className) === target.className,
      )
    : null;
  if (!found) fail('STALE_TARGET', 'Window identity changed immediately before the action');
  if (requireForeground && !found.isForeground) {
    fail('FOREGROUND_MISMATCH', 'Window is not foreground; refusing simulated input');
  }
  if (Number(found.width) < 300 || Number(found.height) < 200) {
    fail('TARGET_NOT_VISIBLE', 'Window was minimized or resized before input');
  }
  if (
    expectedGeometry &&
    (Number(found.width) !== expectedGeometry.target.width ||
      Number(found.height) !== expectedGeometry.target.height)
  ) {
    fail('TARGET_GEOMETRY_CHANGED', 'Probe window resized immediately before input');
  }
  return found;
}

async function confirmFocusedButton(requestTarget, target, runner, expectedGeometry) {
  const focus = JSON.parse(
    await runner(['ui', 'focus', BUTTON_SELECTOR, '-w', String(target.hwnd), '--json']),
  );
  if (Number(focus.hwnd) !== target.hwnd || !focus.elementId) {
    fail('FOCUS_MISMATCH', 'Focus command did not confirm selected window');
  }
  const observed = JSON.parse(await runner(['ui', 'get-focused', '-w', String(target.hwnd), '--json']));
  if (
    observed.hasFocus !== true ||
    observed.element?.automationId !== BUTTON_SELECTOR ||
    observed.element?.type !== 'Button' ||
    observed.element?.isEnabled !== true ||
    observed.element?.isOffscreen === true
  ) {
    fail('FOCUS_MISMATCH', 'Keyboard focus is not on verified probe button');
  }
  const fresh = await executeReadOnly(requestTarget, runner);
  const geometry = assertProbePointerReady(fresh);
  assertStableProbeGeometry(expectedGeometry, geometry);
  await assertFreshTarget(target, runner, true, geometry);
  return geometry.button;
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

export async function inspectChildHandle({ parentHwnd, reportedHwnd, expectedPid }) {
  if (![parentHwnd, reportedHwnd, expectedPid].every((n) => Number.isSafeInteger(n) && n > 0)) {
    fail('INVALID_WINDOW_HANDLE', 'Input window handles and process ID must be positive integers');
  }
  // Resolve beside this exact versioned prototype (source or staged dist).
  const script = fileURLToPath(new URL('./Check-DesktopWindowHandle.ps1', import.meta.url));
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-File',
      script,
      '-ParentHwnd',
      String(parentHwnd),
      '-ReportedHwnd',
      String(reportedHwnd),
      '-ExpectedPid',
      String(expectedPid),
    ],
    { cwd: repo, windowsHide: true, timeout: 10000, maxBuffer: 8192, shell: false },
  );
  const details = JSON.parse(stdout);
  if (
    details.schemaVersion !== 1 ||
    details.parentHwnd !== parentHwnd ||
    details.reportedHwnd !== reportedHwnd ||
    details.parentPid !== expectedPid ||
    details.reportedPid !== expectedPid ||
    details.ancestorHwnd !== parentHwnd
  ) {
    fail('WINDOW_IDENTITY_MISMATCH', 'Reported input HWND did not belong to the selected target');
  }
  return details;
}

export async function invokeProbeOnce(
  request,
  { runner = runWinapp, root = DEFAULT_ROOT, handleInspector = inspectChildHandle } = {},
) {
  try {
    return await withDesktopAdmission(
      path.join(root, 'desktop-input-turn.lock'),
      { producer: 'desktop-probe-action', requestId: request.requestId },
      () => invokeProbeOnceOwned(request, { runner, root, handleInspector }),
    );
  } catch (error) {
    if (error instanceof DesktopAdmissionError) fail(error.code, error.message);
    throw error;
  }
}

async function invokeProbeOnceOwned(
  request,
  { runner = runWinapp, root = DEFAULT_ROOT, handleInspector = inspectChildHandle } = {},
) {
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
      previous.expectedCount !== request.expectedCount ||
      (previous.method ?? 'uia') !== request.method
    ) {
      fail('REQUEST_ID_CONFLICT', 'Action ID belongs to another target or expected state');
    }
    return { ok: true, replayed: true, ...previous };
  }
  // A previous uncertain request remains refused even when its shared lock is retained.
  if (await readReceipt(intentPath)) {
    fail('ACTION_RECOVERY_REQUIRED', 'Previous action has an unfinished intent');
  }
  let lock;
  try {
    lock = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('UI_TURN_BUSY', 'Another desktop input turn or orphaned lock exists');
    throw error;
  }
  const original = await lock.stat();
  const leaseId = randomUUID();
  const ownerStamp = {
    schemaVersion: 1,
    kind: 'workbridge.gui-turn',
    leaseId,
    producer: 'desktop-probe-action',
    requestId: request.requestId,
    owner: { pid: process.pid, processStartUtc: null, sessionId: null },
    target: { kind: 'window', pid: request.target.pid, hwnd: request.target.hwnd, process: PROBE_PROCESS },
    acquiredUtc: new Date().toISOString(),
  };
  const stampBytes = Buffer.from(JSON.stringify(ownerStamp) + '\n', 'utf8');
  const stampHash = createHash('sha256').update(stampBytes).digest('hex');
  let stampReady = false;
  let intentStarted = false;
  let intentHash = null;
  let completed = false;
  try {
    if (stampBytes.length > 4096) fail('ACTION_RECOVERY_REQUIRED', 'Desktop owner stamp exceeds 4 KiB');
    await lock.writeFile(stampBytes);
    await lock.sync();
    stampReady = true;
    // A surviving quarantine sidecar vetoes new input even without its original lock.
    const entries = await readdir(root);
    if (entries.some((name) => name.startsWith('desktop-turn-quarantine-') && name.endsWith('.json'))) {
      fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop quarantine sidecar requires manual reconciliation');
    }
    if ((await readReceipt(receiptPath)) || (await readReceipt(intentPath))) {
      fail('ACTION_RECOVERY_REQUIRED', 'Previous action has a receipt or an unfinished intent');
    }
    const preflight = await executeReadOnly(request.target, runner);
    const target = assertProbeActionReady(preflight);
    const pointerGeometry = request.method === 'uia' ? null : assertProbePointerReady(preflight);
    const before = await readProbeCount(root, target.pid);
    if (before.counter !== request.expectedCount) {
      fail('EXPECTED_STATE_MISMATCH', 'Probe counter differs from the expected value');
    }
    await assertFreshTarget(target, runner);
    const intent = {
      schemaVersion: 1,
      leaseId,
      requestId: request.requestId,
      pid: target.pid,
      hwnd: target.hwnd,
      expectedCount: request.expectedCount,
      selector: BUTTON_SELECTOR,
      method: request.method,
      startedUtc: new Date().toISOString(),
    };
    const intentBytes = JSON.stringify(intent) + '\n';
    intentHash = createHash('sha256').update(intentBytes).digest('hex');
    intentStarted = true;
    let intentHandle;
    try {
      intentHandle = await open(intentPath, 'wx');
      await intentHandle.writeFile(intentBytes, 'utf8');
      await intentHandle.sync();
    } finally {
      await intentHandle?.close();
    }
    let result;
    let button = null;
    try {
      if (request.method === 'uia') {
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
      } else {
        button = await confirmFocusedButton(request.target, target, runner, pointerGeometry);
        if (request.method === 'keyboard') {
          result = JSON.parse(
            await runner([
              'ui',
              'send-keys',
              'enter',
              '-w',
              String(target.hwnd),
              '--target',
              BUTTON_SELECTOR,
              '--via',
              'post-message',
              '--json',
            ]),
          );
        } else {
          result = JSON.parse(
            await runner(['ui', 'click', BUTTON_SELECTOR, '-w', String(target.hwnd), '--json']),
          );
        }
      }
    } catch (error) {
      // Record only a bounded error category; never leak incidental window or typed content.
      const reason =
        error instanceof DesktopUiError
          ? error.code
          : error instanceof SyntaxError
            ? 'INVALID_WINAPP_JSON'
            : 'WINAPP_COMMAND_FAILED';
      fail(
        'ACTION_RECOVERY_REQUIRED',
        `Input result uncertain (${reason}); inspect intent and native probe counter`,
      );
    }
    const validAction =
      request.method === 'uia'
        ? result.performedAction === 'invoke'
        : request.method === 'keyboard'
          ? result.keys === 'enter' &&
            result.via === 'post-message' &&
            result.actionCount === 1 &&
            result.target === BUTTON_SELECTOR &&
            Array.isArray(result.warnings) &&
            result.warnings.length === 0
          : result.clickType === 'click' &&
            Number.isFinite(result.x) &&
            Number.isFinite(result.y) &&
            Math.abs(result.x - (button.x + button.width / 2)) <= 20 &&
            Math.abs(result.y - (button.y + button.height / 2)) <= 20;
    let handleMatches = Number(result.hwnd) === target.hwnd;
    const reportedHwnd = Number(result.hwnd);
    if (
      request.method === 'keyboard' &&
      !handleMatches &&
      Number.isSafeInteger(reportedHwnd) &&
      reportedHwnd > 0
    ) {
      try {
        const identity = await handleInspector({
          parentHwnd: target.hwnd,
          reportedHwnd,
          expectedPid: target.pid,
        });
        handleMatches =
          identity.belongsToTarget === true &&
          identity.parentHwnd === target.hwnd &&
          identity.reportedHwnd === reportedHwnd &&
          identity.parentPid === target.pid &&
          identity.reportedPid === target.pid &&
          identity.ancestorHwnd === target.hwnd;
      } catch {
        fail('ACTION_RECOVERY_REQUIRED', 'Input child-window identity could not be verified');
      }
    }
    if (!handleMatches || !validAction) {
      const checks = {
        hwnd: handleMatches,
        reportedHwnd: Number.isSafeInteger(Number(result.hwnd)) ? Number(result.hwnd) : null,
        expectedHwnd: target.hwnd,
        keys: result.keys === 'enter',
        via: result.via === 'post-message',
        actionCount: result.actionCount === 1,
        target: result.target === BUTTON_SELECTOR,
        warningsEmpty: Array.isArray(result.warnings) && result.warnings.length === 0,
        coordinates:
          request.method !== 'mouse' ||
          (Number.isFinite(result.x) &&
            Number.isFinite(result.y) &&
            Math.abs(result.x - (button.x + button.width / 2)) <= 20 &&
            Math.abs(result.y - (button.y + button.height / 2)) <= 20),
      };
      fail('ACTION_RECOVERY_REQUIRED', 'Input metadata guard failed: ' + JSON.stringify(checks));
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
      reportedHwnd,
      handleRelationship: reportedHwnd === target.hwnd ? 'top-level' : 'verified-child',
      action: request.method === 'uia' ? 'invoke' : request.method === 'mouse' ? 'click' : 'enter',
      inputMethod:
        request.method === 'uia'
          ? 'UIAutomation.InvokePattern'
          : request.method === 'keyboard'
            ? 'WinApp post-message (HWND-targeted)'
            : 'WinApp pointer click',
      osMouseKeyboardInjected: request.method === 'mouse',
    };
    await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
    completed = true;
    return { ok: true, replayed: false, ...receipt };
  } finally {
    // Once intent may have been issued, uncertainty must block ALL other GUI request IDs.
    // Keep the shared lock and a linked, immutable quarantine record for explicit review.
    try {
      if (intentStarted && !completed && stampReady) {
        const record = {
          schemaVersion: 1,
          kind: 'workbridge.gui-turn-quarantine',
          leaseId,
          requestId: request.requestId,
          ownerStampSha256: stampHash,
          intentSha256: intentHash,
          reasonCode: 'ACTION_RECOVERY_REQUIRED',
          processTreeSettlement: 'unknown',
          automaticRetryAllowed: false,
          createdUtc: new Date().toISOString(),
        };
        let quarantine;
        let sealFailed = false;
        try {
          quarantine = await open(path.join(root, 'desktop-turn-quarantine-' + leaseId + '.json'), 'wx');
          await quarantine.writeFile(JSON.stringify(record) + '\n', 'utf8');
          await quarantine.sync();
        } catch {
          sealFailed = true;
        } finally {
          try {
            await quarantine?.close();
          } catch {
            sealFailed = true;
          }
        }
        if (sealFailed) {
          fail('ACTION_RECOVERY_REQUIRED', 'Quarantine seal unavailable; original desktop lock retained');
        }
      }
    } finally {
      await lock.close();
    }
    let current;
    let bytes;
    try {
      current = await lstat(lockPath);
      bytes = await readFile(lockPath);
    } catch {
      fail('ACTION_RECOVERY_REQUIRED', 'Desktop owner lock disappeared; review required');
    }
    if (
      current.dev !== original.dev ||
      current.ino !== original.ino ||
      current.isSymbolicLink() ||
      createHash('sha256').update(bytes).digest('hex') !== stampHash
    ) {
      fail('ACTION_RECOVERY_REQUIRED', 'Desktop owner lock changed; review required');
    }
    if (!intentStarted || completed) await unlink(lockPath);
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
