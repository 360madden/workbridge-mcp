#!/usr/bin/env node
// Guarded screenshot of the single running RIFT-Lab-1 VMware Workstation host window.
// VM is never powered, configured or given guest keyboard/mouse input.
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { captureWindow, verifyPng } from './desktop-capture.mjs';
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

function sameEvidenceSnapshot(a, b) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}

async function readOptionalJson(filename) {
  let info;
  try {
    info = await lstat(filename);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt cannot be inspected');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > 64 * 1024) {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt is not a bounded regular file');
  }
  let parsed;
  try {
    const bytes = await readFile(filename);
    const after = await lstat(filename);
    if (bytes.length !== info.size || !sameEvidenceSnapshot(info, after)) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt changed during inspection');
    }
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt is unreadable or changing');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Existing capture intent or receipt has invalid shape');
  }
  return parsed;
}

function validEvidenceTime(value) {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

async function verifyExistingCaptureEvidence(previous, request, evidenceRoot) {
  // A durable aggregate replay is verification only: never invoke WinApp or captureWindow here.
  const intent = await readOptionalJson(
    path.join(evidenceRoot, 'vm-host-capture-' + request.requestId + '.intent.json'),
  );
  if (!intent) fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture has no original intent');
  const imagePath = path.join(evidenceRoot, 'capture-' + request.requestId + '.png');
  const innerReceiptPath = path.join(evidenceRoot, 'capture-' + request.requestId + '.json');
  const inner = await readOptionalJson(innerReceiptPath);
  if (!inner) fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture has no inner receipt');
  let imageInfo;
  try {
    imageInfo = await lstat(imagePath);
  } catch {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture image is missing');
  }
  if (
    !imageInfo.isFile() ||
    imageInfo.isSymbolicLink() ||
    imageInfo.nlink !== 1 ||
    imageInfo.size < 45 ||
    imageInfo.size > 8 * 1024 * 1024
  ) {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture image is not a bounded regular file');
  }
  let image;
  let dimensions;
  try {
    image = await readFile(imagePath);
    const imageAfter = await lstat(imagePath);
    if (image.length !== imageInfo.size || !sameEvidenceSnapshot(imageInfo, imageAfter)) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture image changed during inspection');
    }
    dimensions = verifyPng(image);
  } catch {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Prior VMware capture image failed PNG verification or changed');
  }
  const sha256 = createHash('sha256').update(image).digest('hex');
  if (
    image.length !== imageInfo.size ||
    intent.schemaVersion !== 1 ||
    intent.requestId !== request.requestId ||
    intent.vmx !== request.vmx ||
    intent.pid !== request.target.pid ||
    intent.hwnd !== request.target.hwnd ||
    intent.expectedClass !== request.expectedClass ||
    !['visible', 'minimized'].includes(intent.originalWindowState) ||
    !validEvidenceTime(intent.startedUtc) ||
    inner.schemaVersion !== 1 ||
    inner.requestId !== request.requestId ||
    inner.pid !== request.target.pid ||
    inner.hwnd !== request.target.hwnd ||
    inner.process !== request.target.process ||
    inner.title !== VM_TITLE ||
    inner.expectedClass !== request.expectedClass ||
    inner.imagePath !== imagePath ||
    inner.inputInjected !== false ||
    inner.foregroundMayChange !== true ||
    !validEvidenceTime(inner.capturedUtc) ||
    Date.parse(inner.capturedUtc) < Date.parse(intent.startedUtc) ||
    inner.sizeBytes !== image.length ||
    inner.width !== dimensions.width ||
    inner.height !== dimensions.height ||
    inner.sha256 !== sha256 ||
    previous.schemaVersion !== 1 ||
    previous.requestId !== request.requestId ||
    previous.vmx !== request.vmx ||
    previous.pid !== request.target.pid ||
    previous.hwnd !== request.target.hwnd ||
    previous.expectedClass !== request.expectedClass ||
    previous.startedUtc !== intent.startedUtc ||
    previous.originalWindowState !== intent.originalWindowState ||
    previous.finalWindowState !== intent.originalWindowState ||
    !validEvidenceTime(previous.completedUtc) ||
    Date.parse(previous.completedUtc) < Date.parse(inner.capturedUtc) ||
    (intent.originalWindowState === 'visible'
      ? previous.stateRecovery !== 'not-needed'
      : !['minimized', 'already-minimized'].includes(previous.stateRecovery)) ||
    previous.imagePath !== imagePath ||
    previous.sizeBytes !== image.length ||
    previous.width !== dimensions.width ||
    previous.height !== dimensions.height ||
    previous.sha256 !== sha256 ||
    previous.guestInputInjected !== false ||
    previous.vmrunPasswordUsed !== false
  ) {
    fail('CAPTURE_RECOVERY_REQUIRED', 'Previously certified VMware image evidence is inconsistent');
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
    await verifyExistingCaptureEvidence(previous, request, evidenceRoot);
    return { ...previous, ok: true, replayed: true };
  }

  let lease;
  try {
    lease = await open(lockPath, 'wx');
  } catch (error) {
    if (error.code === 'EEXIST') fail('UI_TURN_BUSY', 'Another desktop input/capture turn holds the lease');
    throw error;
  }
  const ownedLease = await lease.stat();
  const leaseId = randomUUID();
  const ownerStamp = {
    schemaVersion: 1,
    kind: 'workbridge.gui-turn',
    leaseId,
    producer: 'vmware-host-capture',
    requestId: request.requestId,
    owner: { pid: process.pid, processStartUtc: null, sessionId: null },
    target: {
      kind: 'vmware-host-window',
      pid: request.target.pid,
      hwnd: request.target.hwnd,
      vmx: request.vmx,
    },
    acquiredUtc: new Date().toISOString(),
  };
  const stampBytes = Buffer.from(JSON.stringify(ownerStamp) + '\n');
  const stampHash = createHash('sha256').update(stampBytes).digest('hex');
  let stampWritten = false;
  let quarantineLease = true;
  let intentStarted = false;
  let intentHash = null;
  try {
    if (stampBytes.length > 4096)
      fail('UI_TURN_RECOVERY_REQUIRED', 'VMware desktop owner stamp exceeds 4 KiB');
    await lease.writeFile(stampBytes);
    await lease.sync();
    stampWritten = true;
    quarantineLease = false;
    // Existing quarantine remains authoritative if an earlier lock was lost or archived.
    const entries = await readdir(evidenceRoot);
    if (entries.some((name) => name.startsWith('desktop-turn-quarantine-') && name.endsWith('.json'))) {
      fail('UI_TURN_RECOVERY_REQUIRED', 'Desktop quarantine sidecar requires manual reconciliation');
    }
    if ((await readOptionalJson(intentPath)) || (await readOptionalJson(receiptPath))) {
      fail('CAPTURE_RECOVERY_REQUIRED', 'Previous host capture is incomplete; inspect saved intent');
    }
    // Incomplete inner screenshot artifacts must not cause a fresh VM window action.
    for (const name of ['capture-' + request.requestId + '.png', 'capture-' + request.requestId + '.json']) {
      try {
        await lstat(path.join(evidenceRoot, name));
        fail('CAPTURE_RECOVERY_REQUIRED', 'Orphaned inner screenshot evidence requires review');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const running = await vmLister();
    const preflight = await executeReadOnly(request.target, runner);
    const before = assertVmAndWindow(request, running, preflight);
    const intent = {
      schemaVersion: 1,
      leaseId,
      requestId: request.requestId,
      vmx: request.vmx,
      pid: request.target.pid,
      hwnd: request.target.hwnd,
      expectedClass: request.expectedClass,
      originalWindowState: before.state,
      startedUtc: new Date().toISOString(),
    };
    const intentBytes = JSON.stringify(intent) + '\n';
    intentHash = createHash('sha256').update(intentBytes).digest('hex');
    intentStarted = true;
    quarantineLease = true;
    let intentHandle;
    try {
      intentHandle = await open(intentPath, 'wx');
      await intentHandle.writeFile(intentBytes, 'utf8');
      await intentHandle.sync();
    } finally {
      await intentHandle?.close();
    }

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
    quarantineLease = false;
    return { ok: true, replayed: false, ...receipt };
  } finally {
    let sidecarSealFailed = false;
    try {
      if (quarantineLease && intentStarted && stampWritten) {
        const quarantine = {
          schemaVersion: 1,
          kind: 'workbridge.gui-turn-quarantine',
          leaseId,
          requestId: request.requestId,
          ownerStampSha256: stampHash,
          intentSha256: intentHash,
          reasonCode: 'CAPTURE_RECOVERY_REQUIRED',
          processTreeSettlement: 'unknown',
          automaticRetryAllowed: false,
          createdUtc: new Date().toISOString(),
        };
        let sidecar;
        try {
          sidecar = await open(path.join(evidenceRoot, 'desktop-turn-quarantine-' + leaseId + '.json'), 'wx');
          await sidecar.writeFile(JSON.stringify(quarantine) + '\n', 'utf8');
          await sidecar.sync();
        } catch {
          sidecarSealFailed = true;
        } finally {
          try {
            await sidecar?.close();
          } catch {
            sidecarSealFailed = true;
          }
        }
      }
    } finally {
      await lease.close();
    }
    if (sidecarSealFailed) {
      fail(
        'CAPTURE_RECOVERY_REQUIRED',
        'VMware capture quarantine could not be sealed; original lock retained',
      );
    }
    let currentLease;
    let currentBytes;
    let currentAfter;
    try {
      currentLease = await lstat(lockPath);
      currentBytes = await readFile(lockPath);
      currentAfter = await lstat(lockPath);
    } catch {
      fail('UI_TURN_RECOVERY_REQUIRED', 'VMware desktop lease disappeared during capture');
    }
    if (
      !currentLease.isFile() ||
      currentLease.isSymbolicLink() ||
      currentLease.nlink !== 1 ||
      currentLease.dev !== ownedLease.dev ||
      currentLease.ino !== ownedLease.ino ||
      !sameEvidenceSnapshot(currentLease, currentAfter) ||
      createHash('sha256').update(currentBytes).digest('hex') !== stampHash
    ) {
      fail('UI_TURN_RECOVERY_REQUIRED', 'VMware desktop lease changed; preserve foreign ownership');
    }
    // An uncertain post-intent action can still own a child process or changed window state.
    // Keep the lock until a separate verified recovery decision; never clear by age.
    if (!quarantineLease) await unlink(lockPath);
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
