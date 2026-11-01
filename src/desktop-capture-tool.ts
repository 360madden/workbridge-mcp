import { fileURLToPath } from 'node:url';
import { invokeDesktopPrototype } from './desktop-cli-runner.js';

type CaptureRequest = {
  pid: number;
  hwnd: number;
  process: string;
  requestId: string;
  title?: string;
  className?: string;
};

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

function isText(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return (
    typeof value === 'string' &&
    (allowEmpty || value.length > 0) &&
    value.length <= maxLength &&
    !/[\x00-\x1f\x7f]/.test(value)
  );
}

/** Capture through the existing guarded CLI; image bytes are handled separately. */
export async function desktopCaptureWindow(
  request: CaptureRequest,
  runner = invokeDesktopPrototype,
): Promise<Record<string, unknown>> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    fail('INVALID_ARGUMENTS', 'A capture target is required');
  }
  // Copy validated values before awaiting the runner so caller mutations cannot change the guard.
  const { pid, hwnd, process: processName, requestId, title, className } = request;
  if (
    !Number.isSafeInteger(pid) ||
    pid < 1 ||
    pid > 0x7fffffff ||
    !Number.isSafeInteger(hwnd) ||
    hwnd < 1 ||
    typeof processName !== 'string' ||
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(processName)
  ) {
    fail('INVALID_TARGET', 'Capture requires an exact PID, HWND and process name');
  }
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId)) {
    fail('INVALID_REQUEST_ID', 'requestId must contain 8-64 alphanumeric, underscore or hyphen characters');
  }
  if (
    // The existing script reparses title as a separate option value; leading '-' is ambiguous.
    (title !== undefined && (!isText(title, 200) || title.startsWith('-'))) ||
    (className !== undefined && (typeof className !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(className)))
  ) {
    fail('INVALID_ARGUMENTS', 'Invalid expected window title or class');
  }
  const args = [
    '--pid',
    String(pid),
    '--hwnd',
    String(hwnd),
    '--process',
    processName,
    '--request-id',
    requestId,
    // Equals form keeps class names literal CLI values even when they begin with '-'.
    ...(title === undefined ? [] : [`--title=${title}`]),
    ...(className === undefined ? [] : [`--class=${className}`]),
  ];
  const receipt = await runner('desktop-capture.mjs', args);
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt) || receipt.ok !== true) {
    fail('INVALID_CAPTURE_RECEIPT', 'Capture did not return a successful receipt');
  }
  if (
    receipt.requestId !== requestId ||
    receipt.pid !== pid ||
    receipt.hwnd !== hwnd ||
    receipt.process !== processName ||
    receipt.expectedClass !== (className ?? null) ||
    (title !== undefined && receipt.title !== title)
  ) {
    fail('CAPTURE_TARGET_MISMATCH', 'Capture receipt does not match the requested identity');
  }
  const expectedImagePath = fileURLToPath(
    new URL(`../.tools/desktop-evidence/capture-${requestId}.png`, import.meta.url),
  );
  if (
    receipt.schemaVersion !== 1 ||
    typeof receipt.replayed !== 'boolean' ||
    !isText(receipt.title, 200, true) ||
    !isText(receipt.capturedUtc, 40) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(receipt.capturedUtc) ||
    !Number.isFinite(Date.parse(receipt.capturedUtc)) ||
    new Date(receipt.capturedUtc).toISOString() !== receipt.capturedUtc ||
    !isText(receipt.imagePath, 32767) ||
    receipt.imagePath !== expectedImagePath ||
    !Number.isSafeInteger(receipt.width) ||
    (receipt.width as number) < 1 ||
    (receipt.width as number) > 10000 ||
    !Number.isSafeInteger(receipt.height) ||
    (receipt.height as number) < 1 ||
    (receipt.height as number) > 10000 ||
    !Number.isSafeInteger(receipt.sizeBytes) ||
    (receipt.sizeBytes as number) < 45 ||
    (receipt.sizeBytes as number) > 8 * 1024 * 1024 ||
    typeof receipt.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(receipt.sha256) ||
    receipt.inputInjected !== false ||
    receipt.foregroundMayChange !== true
  ) {
    fail('INVALID_CAPTURE_RECEIPT', 'Capture receipt has invalid evidence metadata');
  }
  // Preserve source values, but never forward unrecognized CLI output to MCP callers.
  const safeFields = [
    'ok',
    'replayed',
    'schemaVersion',
    'requestId',
    'pid',
    'hwnd',
    'process',
    'expectedClass',
    'title',
    'capturedUtc',
    'imagePath',
    'width',
    'height',
    'sizeBytes',
    'sha256',
    'inputInjected',
    'foregroundMayChange',
  ];
  return Object.fromEntries(safeFields.map((field) => [field, receipt[field]]));
}
