import { invokeDesktopPrototype } from './desktop-cli-runner.js';

export type DesktopProbeActionRequest = {
  pid: number;
  hwnd: number;
  requestId: string;
  expectedCount: number;
  method: 'uia';
};

type Outcome = 'not-dispatched' | 'uncertain';

/** Safe for MCP error serialization; never includes runner output or raw causes. */
export class DesktopProbeActionError extends Error {
  readonly code: string;
  readonly outcome: Outcome;
  readonly requestId: string | undefined;

  constructor(code: string, outcome: Outcome, requestId?: string) {
    super(
      outcome === 'uncertain'
        ? 'Probe action outcome is uncertain. Inspect the existing intent, receipt and native counter; do not resend with a new request ID.'
        : 'Probe action was not dispatched. Recheck the exact target, expected count and existing request evidence.',
    );
    this.name = 'DesktopProbeActionError';
    this.code = code;
    this.outcome = outcome;
    this.requestId = requestId;
  }
}

export const DESKTOP_PROBE_ACTION_DESCRIPTION =
  'Pilot: invoke only the disposable DesktopProbe IncrementButton through UIAutomation.InvokePattern. Requires exact fresh PID/HWND, expected native count and durable request ID. May change foreground; foreground restoration is not guaranteed. Completed replay returns historical evidence without another action. Uncertain actions require intent/native-counter review, never a new-ID retry. Parent registration must coordinate the shared desktop GUI turn without double-acquiring the pilot lock. No keyboard, mouse, arbitrary selectors, browser or VMware input.';

const notDispatchedCodes = new Set([
  'STALE_TARGET',
  'ACTION_NOT_READY',
  'EXPECTED_STATE_MISMATCH',
  'UI_TURN_BUSY',
  'REQUEST_ID_CONFLICT',
]);

function utc(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

/**
 * Reuses the pilot's durable intent/receipt and desktop-input-turn.lock; no outer
 * lock here (it would deadlock the child). Parent integration owns shared-turn
 * coordination and release gates. This module neither registers nor launches a tool.
 * Native counter proof is validated by the pilot, not independently reread here.
 */
export async function desktopProbeAction(
  request: DesktopProbeActionRequest,
  runner = invokeDesktopPrototype,
): Promise<Record<string, unknown>> {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    throw new DesktopProbeActionError('INVALID_ARGUMENTS', 'not-dispatched');
  }
  // Snapshot all guards before awaiting: caller mutation cannot redirect validation.
  const { pid, hwnd, requestId, expectedCount, method } = request;
  const safeId =
    typeof requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(requestId)
      ? requestId
      : undefined;
  if (
    Object.keys(request).some((key) => !['pid', 'hwnd', 'requestId', 'expectedCount', 'method'].includes(key))
  ) {
    throw new DesktopProbeActionError('INVALID_ARGUMENTS', 'not-dispatched', safeId);
  }
  if (!Number.isSafeInteger(pid) || pid < 1 || pid > 0x7fffffff || !Number.isSafeInteger(hwnd) || hwnd < 1) {
    throw new DesktopProbeActionError('INVALID_TARGET', 'not-dispatched', safeId);
  }
  if (!safeId) throw new DesktopProbeActionError('INVALID_REQUEST_ID', 'not-dispatched');
  if (!Number.isInteger(expectedCount) || expectedCount < 0 || expectedCount > 99) {
    throw new DesktopProbeActionError('INVALID_EXPECTED_STATE', 'not-dispatched', safeId);
  }
  if (method !== 'uia') {
    throw new DesktopProbeActionError('INVALID_METHOD', 'not-dispatched', safeId);
  }

  let receipt: Record<string, unknown>;
  try {
    receipt = await runner(
      'desktop-probe-act.mjs',
      [
        '--pid',
        String(pid),
        '--hwnd',
        String(hwnd),
        '--request-id',
        safeId,
        '--expected-count',
        String(expectedCount),
        '--method',
        'uia',
      ],
      { timeoutMs: 45_000, maxOutputBytes: 16 * 1024 },
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && notDispatchedCodes.has(code)) {
      throw new DesktopProbeActionError(code, 'not-dispatched', safeId);
    }
    // The fixed runner sanitizes nonzero CLI exits to DESKTOP_PROCESS_FAILED.
    // It cannot prove whether invocation occurred: never infer a safe retry.
    throw new DesktopProbeActionError('ACTION_RECOVERY_REQUIRED', 'uncertain', safeId);
  }

  if (
    !receipt ||
    typeof receipt !== 'object' ||
    Array.isArray(receipt) ||
    receipt.ok !== true ||
    Object.hasOwn(receipt, 'error') ||
    receipt.schemaVersion !== 1 ||
    typeof receipt.replayed !== 'boolean' ||
    receipt.requestId !== safeId ||
    receipt.pid !== pid ||
    receipt.hwnd !== hwnd ||
    receipt.expectedCount !== expectedCount ||
    receipt.method !== 'uia' ||
    receipt.selector !== 'IncrementButton' ||
    receipt.action !== 'invoke' ||
    receipt.inputMethod !== 'UIAutomation.InvokePattern' ||
    receipt.osMouseKeyboardInjected !== false ||
    receipt.reportedHwnd !== hwnd ||
    receipt.handleRelationship !== 'top-level' ||
    receipt.afterCount !== expectedCount + 1 ||
    !utc(receipt.startedUtc) ||
    !utc(receipt.completedUtc) ||
    Date.parse(receipt.completedUtc) < Date.parse(receipt.startedUtc)
  ) {
    throw new DesktopProbeActionError('ACTION_RECOVERY_REQUIRED', 'uncertain', safeId);
  }

  // Explicit projection excludes unrecognized output (including incidental secrets).
  const fields = [
    'ok',
    'schemaVersion',
    'replayed',
    'requestId',
    'pid',
    'hwnd',
    'expectedCount',
    'method',
    'selector',
    'startedUtc',
    'completedUtc',
    'afterCount',
    'reportedHwnd',
    'handleRelationship',
    'action',
    'inputMethod',
    'osMouseKeyboardInjected',
  ];
  return {
    ...Object.fromEntries(fields.map((field) => [field, receipt[field]])),
    foregroundMayChange: true,
    foregroundRestorationGuaranteed: false,
  };
}
