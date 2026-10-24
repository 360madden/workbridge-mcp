#!/usr/bin/env node
// Guarded screenshot of the single running RIFT-Lab-1 VMware Workstation host window.
// VM is never powered, configured or given guest keyboard/mouse input.
import { execFile } from 'node:child_process';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { captureWindow } from './desktop-capture.mjs';
import { DesktopUiError, executeReadOnly, parseRequest, runWinapp } from './desktop-ui.mjs';

const repo = fileURLToPath(new URL('..', import.meta.url));
const DEFAULT_ROOT = path.join(repo, '.tools', 'desktop-evidence');
const VMX = String.raw`C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx`;
const VM_TITLE = 'RIFT-Lab-1 - VMware Workstation';
const VM_CLASS = 'VMUIFrame';
const VM_RUN = String.raw`C:\Program Files\VMware\VMware Workstation\vmrun.exe`;
const execFileAsync = promisify(execFile);

function fail(code, message) {
  throw new DesktopUiError(code, message);
}

export function parseVmwareCaptureRequest(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      strict: true,
      options: {
        pid: { type: 'string' },
        hwnd: { type: 'string' },
        'request-id': { type: 'string' },
      },
    }));
  } catch {
    fail('INVALID_ARGUMENTS', 'Required: --pid --hwnd --request-id');
  }
  const target = parseRequest([
    'inspect',
    '--pid',
    values.pid ?? '',
    '--hwnd',
    values.hwnd ?? '',
    '--process',
    'vmware',
    '--title',
    VM_TITLE,
    '--depth',
    '2',
  ]);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(values['request-id'] ?? '')) {
    fail('INVALID_REQUEST_ID', 'Use an 8-64 character durable request ID');
  }
  return { target, vmx: VMX, expectedClass: VM_CLASS, requestId: values['request-id'] };
}

export async function readRunningVmList({ executable = VM_RUN } = {}) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(executable, ['-T', 'ws', 'list'], {
      cwd: repo,
      windowsHide: true,
      shell: false,
      timeout: 12000,
      maxBuffer: 16384,
    }));
  } catch {
    fail('VMRUN_INVENTORY_FAILED', 'VMware running-VM inventory was unavailable');
  }
  if (typeof stdout !== 'string' || !/^Total running VMs:\s*[0-9]+/m.test(stdout)) {
    fail('INVALID_VMRUN_LIST', 'VMware returned an unrecognized VM inventory');
  }
  return stdout
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function assertVmAndWindow(request, runningVms, preflight) {
  if (!runningVms.some((p) => p.toLowerCase() === request.vmx.toLowerCase())) {
    fail('VM_NOT_RUNNING', 'Exact RIFT-Lab-1 .vmx is not in the running inventory');
  }
  const win = preflight.target;
  if (
    preflight.readOnly !== true ||
    win.pid !== request.target.pid ||
    win.hwnd !== request.target.hwnd ||
    win.process?.toLowerCase() !== 'vmware' ||
    win.title !== VM_TITLE ||
    win.className !== VM_CLASS
  ) {
    fail('STALE_VM_WINDOW', 'The selected VMware window identity changed');
  }
  const root = preflight.tree.windows.find((w) => Number(w.hwnd) === win.hwnd)?.elements?.[0];
  if (!root || root.type !== 'Window' || root.className !== VM_CLASS) {
    fail('STALE_VM_WINDOW', 'VMware UIA window root could not be verified');
  }
  if (win.width <= 200 && win.height <= 50) {
    if (!root.isOffscreen) fail('AMBIGUOUS_WINDOW_STATE', 'Tiny VMware frame was not marked minimized');
    return { state: 'minimized', target: win, root };
  }
  if (
    win.width < 640 ||
    win.height < 400 ||
    root.isOffscreen ||
    !Number.isFinite(root.x) ||
    !Number.isFinite(root.y) ||
    root.width < 600 ||
    root.height < 350
  ) {
    fail('TARGET_NOT_VISIBLE', 'VMware window has unsupported or obscured display geometry');
  }
  return { state: 'visible', target: win, root };
}

function flatten(elements, output = []) {
  for (const item of elements ?? []) {
    output.push(item);
    flatten(item.children, output);
  }
  return output;
}

export function assertSystemButton(preflight, name) {
  const root = preflight.tree.windows.find((w) => Number(w.hwnd) === preflight.target.hwnd)?.elements?.[0];
  const matches = flatten([root]).filter(
    (item) =>
      item.selector === 'Minimize-Restore' &&
      item.name === name &&
      item.type === 'Button' &&
      item.isEnabled &&
      item.isInvokable,
  );
  if (matches.length !== 1) fail('WINDOW_BUTTON_MISSING', `Expected exact VMware ${name} titlebar action`);
  return matches[0];
}

async function invokeTitlebar(target, name, runner, requestTarget) {
  const observed = await executeReadOnly(requestTarget, runner);
  assertSystemButton(observed, name);
  const result = JSON.parse(
    await runner([
      'ui',
      'invoke',
      'Minimize-Restore',
      '-w',
      String(target.hwnd),
      '--action',
      'invoke',
      '--json',
    ]),
  );
  if (Number(result.hwnd) !== target.hwnd || result.performedAction !== 'invoke') {
    fail('WINDOW_ACTION_UNCERTAIN', `VMware ${name} response did not verify the selected HWND`);
  }
}

async function readOptionalJson(filename) {
  try {
    return JSON.parse(await readFile(filename, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt is unreadable');
  }
}

export async function captureVmwareHostOnce(
  request,
  {
    runner = runWinapp,
    evidenceRoot = DEFAULT_ROOT,
    vmLister = readRunningVmList,
    capture = captureWindow,
  } = {},
) {
  await mkdir(evidenceRoot, { recursive: true });
  const base = 'vm-host-capture-' + request.requestId;
  const intentPath = path.join(evidenceRoot, base + '.intent.json');
  const receiptPath = path.join(evidenceRoot, base + '.json');
  const lockPath = path.join(evidenceRoot, 'desktop-input-turn.lock');
  const captureRequest = {
    target: request.target,
    expectedClass: request.expectedClass,
    requestId: request.requestId,
  };

  const previous = await readOptionalJson(receiptPath);
  if (previous) {
    if (
      previous.pid !== request.target.pid ||
      previous.hwnd !== request.target.hwnd ||
      previous.vmx !== request.vmx ||
      previous.expectedClass !== request.expectedClass
    ) {
      fail('REQUEST_ID_CONFLICT', 'Capture ID already belongs to a different VMware target');
    }
    const image = await capture(captureRequest, { runner, evidenceRoot });
    if (image.sha256 !== previous.sha256) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Previously certified image evidence was modified');
    }
    return { ok: true, replayed: true, ...previous };
  }

  let lease;
  try {
    lease = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('UI_TURN_BUSY', 'Another desktop input/capture turn holds the lease');
    throw error;
  }
  try {
    if ((await readOptionalJson(intentPath)) || (await readOptionalJson(receiptPath))) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Previous host capture is incomplete; inspect saved intent');
    }
    const running = await vmLister();
    const preflight = await executeReadOnly(request.target, runner);
    const before = assertVmAndWindow(request, running, preflight);
    const intent = {
      schemaVersion: 1,
      requestId: request.requestId,
      vmx: request.vmx,
      pid: request.target.pid,
      hwnd: request.target.hwnd,
      expectedClass: request.expectedClass,
      originalWindowState: before.state,
      startedUtc: new Date().toISOString(),
    };
    await writeFile(intentPath, JSON.stringify(intent) + '\n', { flag: 'wx' });

    let restored = false;
    let captureEvidence = null;
    let mainError = null;
    let stateRecovery = before.state === 'visible' ? 'not-needed' : 'pending';
    try {
      if (before.state === 'minimized') {
        await invokeTitlebar(before.target, 'Restore', runner, request.target);
        restored = true;
        const afterRestore = await executeReadOnly(request.target, runner);
        if (assertVmAndWindow(request, running, afterRestore).state !== 'visible') {
          fail('WINDOW_RESTORE_FAILED', 'VMware window was not visible after the targeted restore');
        }
      }
      captureEvidence = await capture(captureRequest, { runner, evidenceRoot });
    } catch (error) {
      mainError = error;
    }

    if (restored) {
      // Preserve the original minimized state when the target still belongs to us.
      try {
        const current = await executeReadOnly(request.target, runner);
        const observed = assertVmAndWindow(request, running, current);
        if (observed.state === 'minimized') {
          stateRecovery = 'already-minimized';
        } else if (observed.target.isForeground) {
          await invokeTitlebar(observed.target, 'Minimize', runner, request.target);
          const finalState = await executeReadOnly(request.target, runner);
          if (assertVmAndWindow(request, running, finalState).state !== 'minimized') {
            fail('WINDOW_STATE_RECOVERY_FAILED', 'VMware failed to return to its prior minimized state');
          }
          stateRecovery = 'minimized';
        } else {
          fail('FOREGROUND_CHANGED', 'Another window took foreground; leave VMware state unchanged');
        }
      } catch {
        stateRecovery = 'requires-review';
      }
    }
    if (mainError || !captureEvidence || stateRecovery === 'requires-review') {
      fail(
        'CAPTURE_RECOVERY_REQUIRED',
        `VMware capture result uncertain; original state: ${before.state}, recovery: ${stateRecovery}`,
      );
    }
    const receipt = {
      ...intent,
      completedUtc: new Date().toISOString(),
      imagePath: captureEvidence.imagePath,
      width: captureEvidence.width,
      height: captureEvidence.height,
      sizeBytes: captureEvidence.sizeBytes,
      sha256: captureEvidence.sha256,
      originalWindowState: before.state,
      finalWindowState: before.state === 'minimized' ? 'minimized' : 'visible',
      stateRecovery,
      guestInputInjected: false,
      vmrunPasswordUsed: false,
    };
    try {
      await writeFile(receiptPath, JSON.stringify(receipt) + '\n', { flag: 'wx' });
    } catch {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Image was captured but aggregate receipt could not be saved');
    }
    return { ok: true, replayed: false, ...receipt };
  } finally {
    await lease.close();
    await unlink(lockPath);
  }
}

async function main() {
  try {
    const request = parseVmwareCaptureRequest(process.argv.slice(2));
    process.stdout.write(JSON.stringify(await captureVmwareHostOnce(request)) + '\n');
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        guestInputInjected: false,
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
