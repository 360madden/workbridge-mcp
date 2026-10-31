/**
 * Offline, fail-closed policy for future UIA preparation. Windows session,
 * OpenInputDesktop/window-station, process and foreground facts must come from
 * an injected observer. This module performs no Windows calls or input.
 * A passing observation is a preview, never an input authorization or lease.
 */
export type DesktopSessionTarget = Readonly<{
  pid: number;
  hwnd: number;
  process: string;
  title: string;
  className: string;
  processStartedAt: string;
  sessionId: number;
}>;

export type DesktopSessionRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** All timestamps ending in MonotonicMs must share the injected clock's origin. */
export type DesktopSessionObservation = Readonly<{
  observedAtMs: number;
  observedAtMonotonicMs: number;
  session: Readonly<{
    id: number;
    ownerSessionId: number;
    interactive: boolean;
    connectionState: string;
    locked: boolean;
    loggingOff: boolean;
    secureDesktop: boolean;
    windowStation: string;
    inputDesktop: string;
  }>;
  window: DesktopSessionTarget &
    Readonly<{
      bounds: DesktopSessionRect;
      isForeground: boolean;
      isVisible: boolean;
      isMinimized: boolean;
    }>;
  foreground: Readonly<{ pid: number; hwnd: number; sessionId: number }>;
  monitors: readonly DesktopSessionRect[];
}>;

export type DesktopSessionTiming = Readonly<{
  nowMonotonicMs: number;
  notBeforeMonotonicMs: number;
  previousMonotonicMs?: number;
}>;

export const DESKTOP_SESSION_MAX_AGE_MS = 2000;
export const DESKTOP_SESSION_MAX_PREPARATION_MS = 5000;

const reasons = {
  INVALID_TARGET: 'An exact bounded process, window, lifetime and session identity is required',
  INVALID_OBSERVATION: 'Explicit structured desktop observations are required',
  INVALID_CLOCK: 'A finite nonnegative monotonic clock is required',
  CLOCK_REGRESSED: 'The monotonic clock moved backwards',
  STALE_OBSERVATION: 'Desktop evidence is outside the bounded preparation freshness window',
  NONINTERACTIVE_SESSION: 'The session is not explicitly interactive',
  SESSION_NOT_ACTIVE: 'The session is disconnected, logging off or not active',
  SESSION_LOCKED: 'The session is locked or its lock state is unknown',
  SECURE_DESKTOP: 'Secure desktop state is present or unknown',
  NONDEFAULT_DESKTOP: 'Input requires the Default desktop on WinSta0',
  SESSION_MISMATCH: 'Observer, target and process must belong to the same interactive session',
  PROCESS_IDENTITY_MISMATCH: 'The exact process lifetime or window identity changed',
  CHATGPT_BROWSER_FORBIDDEN: 'Browser and ChatGPT targets require a separate control path',
  VMWARE_SEPARATE_PATH_REQUIRED: 'VMware host and guest targets require a separate verified path',
  SYSTEM_TARGET_FORBIDDEN: 'Lock, logon and consent processes cannot be UIA input targets',
  FOREGROUND_MISMATCH: 'The independently observed foreground must match the exact target',
  TARGET_NOT_VISIBLE: 'The target must be explicitly visible and unminimized',
  INVALID_GEOMETRY: 'Bounded positive window and monitor geometry is required',
  TARGET_OFFSCREEN: 'The target is outside all observed monitors',
  OBSERVATION_FAILED: 'The injected desktop observer failed',
} as const;

export type DesktopSessionDenialReason = keyof typeof reasons;
export type DesktopSessionDecision =
  | Readonly<{ allowed: false; reason: DesktopSessionDenialReason; message: string }>
  | Readonly<{
      allowed: true;
      previewOnly: true;
      requiresFreshExecutionValidation: true;
      sessionId: number;
      observedAtMonotonicMs: number;
      ageMs: number;
    }>;

export class DesktopSessionPolicyError extends Error {
  readonly code: DesktopSessionDenialReason;
  constructor(code: DesktopSessionDenialReason) {
    super(reasons[code]);
    this.name = 'DesktopSessionPolicyError';
    this.code = code;
  }
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : undefined;
}
function positive(value: unknown, max = Number.MAX_SAFE_INTEGER): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max;
}
function boundedText(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' && !!value.trim() && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
  );
}
function monotonic(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER
  );
}
function targetValid(value: unknown): value is DesktopSessionTarget {
  const t = record(value);
  if (
    !t ||
    !positive(t.pid, 0x7fffffff) ||
    !positive(t.hwnd) ||
    !positive(t.sessionId, 0x7fffffff) ||
    !boundedText(t.process, 80) ||
    !/^[A-Za-z0-9_.-]+$/.test(t.process) ||
    !boundedText(t.title, 200) ||
    !boundedText(t.className, 100) ||
    !boundedText(t.processStartedAt, 30)
  )
    return false;
  const date = Date.parse(t.processStartedAt);
  return Number.isFinite(date) && new Date(date).toISOString() === t.processStartedAt;
}
function protectedReason(t: RecordValue): DesktopSessionDenialReason | undefined {
  const process = typeof t.process === 'string' ? t.process.toLowerCase().replace(/\.exe$/, '') : '';
  const title = typeof t.title === 'string' ? t.title : '';
  const cls = typeof t.className === 'string' ? t.className : '';
  // An ordinary browser tab title cannot exclude ChatGPT in another tab.
  if (
    /^(chrome|msedge|firefox|brave|opera|vivaldi|chromium|browser|dot|atlas|chatgpt)$/.test(process) ||
    /chatgpt|chat\.openai\.com|chatgpt\.com|openai atlas/i.test(title) ||
    /^(Chrome_WidgetWin_|MozillaWindowClass)/i.test(cls)
  )
    return 'CHATGPT_BROWSER_FORBIDDEN';
  if (
    /^vmware(?:[-.]|$)/.test(process) ||
    /vmware (workstation|player)/i.test(title) ||
    /^(VMUIFrame|MKSEmbedded|VMware)/i.test(cls)
  )
    return 'VMWARE_SEPARATE_PATH_REQUIRED';
  if (/^(consent|winlogon|logonui|credentialuibroker|lockapp)$/.test(process))
    return 'SYSTEM_TARGET_FORBIDDEN';
  return undefined;
}
function validRect(value: unknown): value is DesktopSessionRect {
  const r = record(value);
  return (
    !!r &&
    ['x', 'y', 'width', 'height'].every(
      (key) => typeof r[key] === 'number' && Number.isFinite(r[key]) && Math.abs(r[key] as number) <= 100000,
    ) &&
    (r.width as number) > 0 &&
    (r.height as number) > 0
  );
}
function deny(reason: DesktopSessionDenialReason): DesktopSessionDecision {
  return { allowed: false, reason, message: reasons[reason] };
}

/** Pure decision; absent, contradictory and unknown facts fail closed. No cached grants. */
export function evaluateDesktopSessionPolicy(
  target: DesktopSessionTarget,
  observation: DesktopSessionObservation,
  timing: DesktopSessionTiming,
): DesktopSessionDecision {
  if (!targetValid(target)) return deny('INVALID_TARGET');
  const protectedTarget = protectedReason(target);
  if (protectedTarget) return deny(protectedTarget);
  const clock = record(timing);
  if (
    !clock ||
    !monotonic(clock.nowMonotonicMs) ||
    !monotonic(clock.notBeforeMonotonicMs) ||
    (clock.previousMonotonicMs !== undefined && !monotonic(clock.previousMonotonicMs))
  )
    return deny('INVALID_CLOCK');
  const now = clock.nowMonotonicMs;
  const start = clock.notBeforeMonotonicMs;
  if (now < start || (typeof clock.previousMonotonicMs === 'number' && now < clock.previousMonotonicMs))
    return deny('CLOCK_REGRESSED');
  const o = record(observation);
  const session = record(o?.session);
  const window = record(o?.window);
  const foreground = record(o?.foreground);
  if (!o || !session || !window || !foreground || !monotonic(o.observedAtMs))
    return deny('INVALID_OBSERVATION');
  const observed = o.observedAtMonotonicMs;
  if (
    !monotonic(observed) ||
    observed < start ||
    observed > now ||
    now - observed > DESKTOP_SESSION_MAX_AGE_MS ||
    now - start > DESKTOP_SESSION_MAX_PREPARATION_MS
  )
    return deny('STALE_OBSERVATION');
  if (session.interactive !== true) return deny('NONINTERACTIVE_SESSION');
  if (session.connectionState !== 'active' || session.loggingOff !== false) return deny('SESSION_NOT_ACTIVE');
  if (session.locked !== false) return deny('SESSION_LOCKED');
  if (session.secureDesktop !== false) return deny('SECURE_DESKTOP');
  if (session.windowStation !== 'WinSta0' || session.inputDesktop !== 'Default')
    return deny('NONDEFAULT_DESKTOP');
  if (
    session.id !== target.sessionId ||
    session.ownerSessionId !== target.sessionId ||
    window.sessionId !== target.sessionId
  )
    return deny('SESSION_MISMATCH');
  const protectedWindow = protectedReason(window);
  if (protectedWindow) return deny(protectedWindow);
  const identityKeys = ['pid', 'hwnd', 'process', 'title', 'className', 'processStartedAt'] as const;
  if (identityKeys.some((key) => window[key] !== target[key])) return deny('PROCESS_IDENTITY_MISMATCH');
  if (
    window.isForeground !== true ||
    foreground.pid !== target.pid ||
    foreground.hwnd !== target.hwnd ||
    foreground.sessionId !== target.sessionId
  )
    return deny('FOREGROUND_MISMATCH');
  if (window.isVisible !== true || window.isMinimized !== false) return deny('TARGET_NOT_VISIBLE');
  const bounds = window.bounds;
  if (
    !validRect(bounds) ||
    !Array.isArray(o.monitors) ||
    o.monitors.length < 1 ||
    o.monitors.length > 16 ||
    !o.monitors.every(validRect)
  )
    return deny('INVALID_GEOMETRY');
  // Reject the minimized-window dimensions seen in the existing WinApp pilot.
  if (bounds.width <= 160 || bounds.height <= 28) return deny('TARGET_NOT_VISIBLE');
  if (
    !o.monitors.some(
      (m) =>
        bounds.x < m.x + m.width &&
        bounds.x + bounds.width > m.x &&
        bounds.y < m.y + m.height &&
        bounds.y + bounds.height > m.y,
    )
  )
    return deny('TARGET_OFFSCREEN');
  return {
    allowed: true,
    previewOnly: true,
    requiresFreshExecutionValidation: true,
    sessionId: target.sessionId,
    observedAtMonotonicMs: observed,
    ageMs: now - observed,
  };
}

export function assertDesktopSessionPolicy(
  target: DesktopSessionTarget,
  observation: DesktopSessionObservation,
  timing: DesktopSessionTiming,
): void {
  const decision = evaluateDesktopSessionPolicy(target, observation, timing);
  if (!decision.allowed) throw new DesktopSessionPolicyError(decision.reason);
}

/**
 * Integration: pass this return value as worker1 previewDesktopAction's
 * observeDesktop dependency. The native observer must add the explicit facts
 * above, including monotonic timestamps; do not infer them from WinApp success.
 * The clock must be monotonic (e.g. performance.now), never Date.now. No default
 * native provider or clock is installed. Reuse one wrapper for a preparation.
 */
export function createDesktopSessionObserver(dependencies: {
  observeDesktop: (target: DesktopSessionTarget) => Promise<DesktopSessionObservation>;
  nowMonotonicMs: () => number;
}): (target: DesktopSessionTarget) => Promise<DesktopSessionObservation> {
  if (typeof dependencies?.observeDesktop !== 'function')
    throw new DesktopSessionPolicyError('OBSERVATION_FAILED');
  if (typeof dependencies.nowMonotonicMs !== 'function') throw new DesktopSessionPolicyError('INVALID_CLOCK');
  let previous: number | undefined;
  let preparationStarted: number | undefined;
  const clock = () => {
    let value: number;
    try {
      value = dependencies.nowMonotonicMs();
    } catch {
      throw new DesktopSessionPolicyError('INVALID_CLOCK');
    }
    if (!monotonic(value)) throw new DesktopSessionPolicyError('INVALID_CLOCK');
    if (previous !== undefined && value < previous) throw new DesktopSessionPolicyError('CLOCK_REGRESSED');
    previous = value;
    return value;
  };
  return async (target) => {
    if (!targetValid(target)) throw new DesktopSessionPolicyError('INVALID_TARGET');
    const expected = Object.freeze({ ...target });
    const protectedTarget = protectedReason(expected);
    if (protectedTarget) throw new DesktopSessionPolicyError(protectedTarget);
    const started = clock();
    preparationStarted ??= started;
    if (started - preparationStarted > DESKTOP_SESSION_MAX_PREPARATION_MS)
      throw new DesktopSessionPolicyError('STALE_OBSERVATION');
    let observation: DesktopSessionObservation;
    try {
      observation = await dependencies.observeDesktop(expected);
    } catch {
      throw new DesktopSessionPolicyError('OBSERVATION_FAILED');
    }
    const completed = clock();
    if (completed - preparationStarted > DESKTOP_SESSION_MAX_PREPARATION_MS)
      throw new DesktopSessionPolicyError('STALE_OBSERVATION');
    assertDesktopSessionPolicy(expected, observation, {
      nowMonotonicMs: completed,
      notBeforeMonotonicMs: started,
    });
    // Copy only the documented fields; incidental observer content is not returned.
    const { session: s, window: w, foreground: f } = observation;
    return {
      observedAtMs: observation.observedAtMs,
      observedAtMonotonicMs: observation.observedAtMonotonicMs,
      session: {
        id: s.id,
        ownerSessionId: s.ownerSessionId,
        interactive: s.interactive,
        connectionState: s.connectionState,
        locked: s.locked,
        loggingOff: s.loggingOff,
        secureDesktop: s.secureDesktop,
        windowStation: s.windowStation,
        inputDesktop: s.inputDesktop,
      },
      window: {
        ...expected,
        bounds: { ...w.bounds },
        isForeground: w.isForeground,
        isVisible: w.isVisible,
        isMinimized: w.isMinimized,
      },
      foreground: { pid: f.pid, hwnd: f.hwnd, sessionId: f.sessionId },
      monitors: observation.monitors.map((m) => ({ x: m.x, y: m.y, width: m.width, height: m.height })),
    };
  };
}
