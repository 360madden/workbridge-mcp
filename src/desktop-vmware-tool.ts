import { BridgeError } from './core.js';
import { invokeDesktopPrototype } from './desktop-cli-runner.js';

const VMX = String.raw`C:\rift modding\VMs\RIFT-Lab\RIFT-Lab.vmx`;

export interface DesktopVmwareCaptureRequest {
  pid: number;
  hwnd: number;
  requestId: string;
}

function positiveInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
}

/** Host-window capture only; the receipt does not establish guest receiver health. */
export async function desktopCaptureVmware(
  request: DesktopVmwareCaptureRequest,
  runner: typeof invokeDesktopPrototype = invokeDesktopPrototype,
) {
  if (!request || !positiveInteger(request.pid, 0x7fffffff) || !positiveInteger(request.hwnd)) {
    throw new BridgeError('INVALID_TARGET', 'Supply a positive integer PID and safe integer HWND.');
  }
  const { pid, hwnd, requestId } = request;
  if (
    typeof requestId !== 'string' ||
    requestId.length < 8 ||
    requestId.length > 64 ||
    !/^[A-Za-z0-9]/.test(requestId) ||
    /[^A-Za-z0-9_-]/.test(requestId)
  ) {
    throw new BridgeError('INVALID_REQUEST_ID', 'Use an 8-64 character durable request ID.');
  }

  // The existing script owns inventory, exact window identity, UIA restore/reminimize,
  // the shared desktop turn, image verification, and durable intent/replay handling.
  const receipt = await runner(
    'vmware-host-capture.mjs',
    ['--pid', String(pid), '--hwnd', String(hwnd), '--request-id', requestId],
    { timeoutMs: 45_000, maxOutputBytes: 16_384 },
  );
  if (
    !receipt ||
    receipt.ok !== true ||
    receipt.schemaVersion !== 1 ||
    receipt.requestId !== requestId ||
    receipt.pid !== pid ||
    receipt.hwnd !== hwnd ||
    receipt.vmx !== VMX ||
    receipt.expectedClass !== 'VMUIFrame' ||
    receipt.guestInputInjected !== false ||
    receipt.vmrunPasswordUsed !== false ||
    typeof receipt.replayed !== 'boolean' ||
    !(
      (receipt.originalWindowState === 'visible' &&
        receipt.finalWindowState === 'visible' &&
        receipt.stateRecovery === 'not-needed') ||
      (receipt.originalWindowState === 'minimized' &&
        receipt.finalWindowState === 'minimized' &&
        (receipt.stateRecovery === 'minimized' || receipt.stateRecovery === 'already-minimized'))
    ) ||
    typeof receipt.imagePath !== 'string' ||
    receipt.imagePath.length === 0 ||
    receipt.imagePath.length > 4096 ||
    /[\r\n\0]/.test(receipt.imagePath) ||
    !positiveInteger(receipt.width) ||
    !positiveInteger(receipt.height) ||
    !positiveInteger(receipt.sizeBytes) ||
    typeof receipt.sha256 !== 'string' ||
    receipt.sha256.length !== 64 ||
    /[^a-fA-F0-9]/.test(receipt.sha256) ||
    typeof receipt.startedUtc !== 'string' ||
    !Number.isFinite(Date.parse(receipt.startedUtc)) ||
    typeof receipt.completedUtc !== 'string' ||
    !Number.isFinite(Date.parse(receipt.completedUtc))
  ) {
    throw new BridgeError(
      'INVALID_VMWARE_CAPTURE_RECEIPT',
      'VMware host capture receipt did not verify the requested target, image, or window recovery. Inspect saved intent before retrying.',
    );
  }

  // Return bounded, known evidence fields rather than arbitrary CLI metadata.
  return {
    ok: true,
    schemaVersion: 1,
    requestId,
    pid,
    hwnd,
    vmx: VMX,
    expectedClass: 'VMUIFrame',
    replayed: receipt.replayed,
    originalWindowState: receipt.originalWindowState,
    finalWindowState: receipt.finalWindowState,
    stateRecovery: receipt.stateRecovery,
    guestInputInjected: false,
    vmrunPasswordUsed: false,
    startedUtc: receipt.startedUtc,
    completedUtc: receipt.completedUtc,
    imagePath: receipt.imagePath,
    width: receipt.width,
    height: receipt.height,
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256,
  };
}
