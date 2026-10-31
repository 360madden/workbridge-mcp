/**
 * Nonexecuting UIA invoke preview. No runner, focus, input, lease or live default is
 * installed here. Inject scripts/desktop-ui.mjs's executeReadOnly (optionally bound
 * to a runner), and an independent read-only native window/session observer.
 * A successful preview is evidence at one instant, never an execution permit.
 */
export type DesktopActionTarget = Readonly<{
  pid: number;
  hwnd: number;
  process: string;
  title: string;
  className: string;
  processStartedAt: string;
  sessionId: number;
}>;

export type DesktopActionPreviewRequest = Readonly<{
  requestId: string;
  action: 'invoke';
  target: DesktopActionTarget;
  selector: string;
  expectedControlType: string;
}>;

export type DesktopActionRect = Readonly<{ x: number; y: number; width: number; height: number }>;

/** Missing/unknown session and native window facts must fail closed. */
export type DesktopActionObservation = Readonly<{
  observedAtMs: number;
  session: Readonly<{
    id: number;
    interactive: boolean;
    locked: boolean;
    secureDesktop: boolean;
    windowStation: string;
    inputDesktop: string;
  }>;
  window: DesktopActionTarget &
    Readonly<{
      bounds: DesktopActionRect;
      isForeground: boolean;
      isVisible: boolean;
      isMinimized: boolean;
    }>;
  monitors: readonly DesktopActionRect[];
}>;

export type DesktopActionGuardDependencies = {
  executeReadOnly: (request: {
    operation: 'inspect';
    pid: number;
    hwnd: number;
    process: string;
    title: string;
    depth: number;
  }) => Promise<unknown>;
  observeDesktop: (target: DesktopActionTarget) => Promise<DesktopActionObservation>;
  now?: () => number;
};

type JsonObject = Record<string, unknown>;
const MAX_EVIDENCE_BYTES = 384 * 1024;
const MAX_AGE_MS = 2000;
const MAX_PREVIEW_MS = 5000;
const MAX_NODES = 2048;
const MAX_TREE_DEPTH = 32;

export class DesktopActionGuardError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DesktopActionGuardError';
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new DesktopActionGuardError(code, message);
}

function object(value: unknown, code = 'INVALID_EVIDENCE'): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, 'An explicit structured identity or observation is required');
  }
  return value as JsonObject;
}

function exactKeys(value: JsonObject, keys: string[]): void {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))) {
    fail('INVALID_REQUEST', 'Only the documented preview fields are accepted');
  }
}

function text(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    fail('INVALID_REQUEST', 'Preview identity and selector text must be explicit and bounded');
  }
  return value;
}

function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    fail('INVALID_REQUEST', 'Preview identity numbers must be in range');
  }
  return value;
}

function rejectProtectedTarget(target: JsonObject): void {
  const processName = String(target.process)
    .toLowerCase()
    .replace(/\.exe$/, '');
  // A browser's active title cannot establish that its other tabs exclude ChatGPT.
  // Conservatively require a separate browser path for browser windows as well.
  if (
    /^(chrome|msedge|firefox|brave|opera|vivaldi|chromium|browser|dot|atlas|chatgpt)$/.test(processName) ||
    /chatgpt|chat\.openai\.com|chatgpt\.com|openai atlas/i.test(String(target.title)) ||
    /^(Chrome_WidgetWin_|MozillaWindowClass)/i.test(String(target.className))
  ) {
    fail('CHATGPT_BROWSER_FORBIDDEN', 'ChatGPT and browser targets require a separate control path');
  }
  if (
    /^vmware(?:[-.]|$)/.test(processName) ||
    /vmware (workstation|player)/i.test(String(target.title)) ||
    /^(VMUIFrame|MKSEmbedded|VMware)/i.test(String(target.className))
  ) {
    fail('VMWARE_SEPARATE_PATH_REQUIRED', 'VMware host and guest control require a separate verified path');
  }
}

function validateRequest(value: DesktopActionPreviewRequest): DesktopActionPreviewRequest {
  const request = object(value, 'INVALID_REQUEST');
  exactKeys(request, ['requestId', 'action', 'target', 'selector', 'expectedControlType']);
  const target = object(request.target, 'INVALID_REQUEST');
  exactKeys(target, ['pid', 'hwnd', 'process', 'title', 'className', 'processStartedAt', 'sessionId']);
  if (request.action !== 'invoke' || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(text(request.requestId, 64))) {
    fail('INVALID_REQUEST', 'Only an invoke preview with an 8-64 character request ID is supported');
  }
  integer(target.pid, 1, 0x7fffffff);
  integer(target.hwnd, 1);
  integer(target.sessionId, 1, 0x7fffffff);
  if (!/^[A-Za-z0-9_.-]+$/.test(text(target.process, 80))) {
    fail('INVALID_REQUEST', 'An exact process name is required');
  }
  text(target.title, 200);
  text(target.className, 100);
  const startedAt = text(target.processStartedAt, 30);
  if (!Number.isFinite(Date.parse(startedAt)) || new Date(startedAt).toISOString() !== startedAt) {
    fail('INVALID_REQUEST', 'processStartedAt must be a canonical UTC ISO process start time');
  }
  text(request.selector, 200);
  if (!/^[A-Za-z][A-Za-z0-9]{0,63}$/.test(text(request.expectedControlType, 64))) {
    fail('INVALID_REQUEST', 'An exact UIA control type is required');
  }
  rejectProtectedTarget(target);
  // Copy before awaiting: a caller must not retarget a pending preview in place.
  return Object.freeze({ ...value, target: Object.freeze({ ...value.target }) });
}

function snapshot(value: unknown): JsonObject {
  let encoded: string | undefined;
  try {
    encoded = JSON.stringify(value);
  } catch {
    fail('INVALID_EVIDENCE', 'Read-only evidence must be serializable JSON');
  }
  if (encoded === undefined) fail('INVALID_EVIDENCE', 'Read-only evidence is missing');
  if (Buffer.byteLength(encoded, 'utf8') > MAX_EVIDENCE_BYTES) {
    fail('EVIDENCE_LIMIT', 'Read-only evidence exceeds the 384 KiB bound');
  }
  return object(JSON.parse(encoded));
}

function rect(value: unknown): DesktopActionRect {
  const bounds = object(value);
  if (
    !['x', 'y', 'width', 'height'].every(
      (key) =>
        typeof bounds[key] === 'number' && Number.isFinite(bounds[key]) && Math.abs(bounds[key]) <= 100000,
    ) ||
    (bounds.width as number) <= 0 ||
    (bounds.height as number) <= 0
  ) {
    fail('TARGET_NOT_VISIBLE', 'Window and control geometry must be finite and positive');
  }
  return {
    x: bounds.x as number,
    y: bounds.y as number,
    width: bounds.width as number,
    height: bounds.height as number,
  };
}

function contains(outer: DesktopActionRect, inner: DesktopActionRect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function intersects(a: DesktopActionRect, b: DesktopActionRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function assertIdentity(actual: JsonObject, expected: DesktopActionTarget, native: boolean): void {
  rejectProtectedTarget(actual);
  const keys = native
    ? (['pid', 'hwnd', 'process', 'title', 'className', 'processStartedAt', 'sessionId'] as const)
    : (['pid', 'hwnd', 'process', 'title', 'className'] as const);
  if (keys.some((key) => actual[key] !== expected[key])) {
    fail('STALE_TARGET', 'Exact window or process lifetime identity changed');
  }
}

function assertFresh(value: unknown, now: number, startedAt: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < startedAt ||
    value > now ||
    now - value > MAX_AGE_MS
  ) {
    fail('STALE_EVIDENCE', 'Desktop observation was not freshly collected during this preview');
  }
  return value;
}

function assertDesktop(value: JsonObject, target: DesktopActionTarget, now: number, startedAt: number) {
  assertFresh(value.observedAtMs, now, startedAt);
  const session = object(value.session);
  if (
    session.secureDesktop !== false ||
    session.inputDesktop !== 'Default' ||
    session.windowStation !== 'WinSta0'
  ) {
    fail('UNSAFE_DESKTOP', 'An explicitly verified default interactive desktop is required');
  }
  if (session.id !== target.sessionId || session.interactive !== true || session.locked !== false) {
    fail('SESSION_NOT_READY', 'Target must belong to the unlocked interactive desktop session');
  }
  const window = object(value.window);
  assertIdentity(window, target, true);
  if (window.isForeground !== true) fail('FOREGROUND_MISMATCH', 'The target is not already foreground');
  const bounds = rect(window.bounds);
  if (
    window.isVisible !== true ||
    window.isMinimized !== false ||
    bounds.width <= 160 ||
    bounds.height <= 28
  ) {
    fail('TARGET_NOT_VISIBLE', 'A visible, unminimized target window is required');
  }
  if (!Array.isArray(value.monitors) || value.monitors.length < 1 || value.monitors.length > 16) {
    fail('INVALID_EVIDENCE', 'Bounded monitor geometry is required');
  }
  const monitors = value.monitors.map(rect);
  if (!monitors.some((monitor) => intersects(monitor, bounds))) {
    fail('TARGET_NOT_VISIBLE', 'The selected window is outside the observed monitors');
  }
  return { bounds, monitors };
}

function assertUia(
  value: JsonObject,
  request: DesktopActionPreviewRequest,
  bounds: DesktopActionRect,
  monitors: DesktopActionRect[],
) {
  if (
    value.readOnly !== true ||
    value.operation !== 'inspect' ||
    value.backend !== 'Microsoft.WinAppCli' ||
    value.version !== '0.7.1' ||
    value.ok === false ||
    Object.hasOwn(value, 'error')
  ) {
    fail('INVALID_EVIDENCE', 'A successful pinned WinApp read-only inspection is required');
  }
  const target = object(value.target);
  assertIdentity(target, request.target, false);
  if (target.isForeground !== true) fail('FOREGROUND_MISMATCH', 'WinApp did not confirm foreground');
  if (target.width !== bounds.width || target.height !== bounds.height) {
    fail('GEOMETRY_CHANGED', 'WinApp and native window geometry disagree');
  }
  const tree = object(value.tree);
  if (!Array.isArray(tree.windows) || tree.windows.length !== 1) {
    fail('INVALID_EVIDENCE', 'Exactly one selected UIA window tree is required');
  }
  const window = object(tree.windows[0]);
  // The pinned CLI emits a numeric HWND. Do not accept a different or coerced identity.
  if (window.hwnd !== request.target.hwnd) fail('STALE_TARGET', 'UIA tree HWND changed');
  if (!Array.isArray(window.elements) || window.elements.length !== 1) {
    fail('INVALID_EVIDENCE', 'A single UIA window root is required');
  }
  const root = object(window.elements[0]);
  const rootBounds = rect(root);
  if (root.type !== 'Window' || root.isOffscreen !== false || !contains(bounds, rootBounds)) {
    fail('TARGET_NOT_VISIBLE', 'UIA root is offscreen or outside the verified window');
  }
  const matches: { node: JsonObject; ancestors: JsonObject[] }[] = [];
  const pending = [{ node: root, ancestors: [] as JsonObject[] }];
  let count = 0;
  while (pending.length) {
    const current = pending.pop()!;
    if (++count > MAX_NODES || current.ancestors.length > MAX_TREE_DEPTH) {
      fail('EVIDENCE_LIMIT', 'UIA tree exceeds the bounded traversal');
    }
    if (current.node.selector === request.selector) matches.push(current);
    if (current.node.children !== undefined) {
      if (!Array.isArray(current.node.children)) fail('INVALID_EVIDENCE', 'Malformed UIA children');
      for (const child of current.node.children) {
        pending.push({ node: object(child), ancestors: [...current.ancestors, current.node] });
      }
    }
  }
  if (matches.length !== 1) fail('SELECTOR_NOT_UNIQUE', 'The exact selector must match one control');
  const { node, ancestors } = matches[0]!;
  if (node.type !== request.expectedControlType || node.isEnabled !== true || node.isInvokable !== true) {
    fail('CONTROL_NOT_READY', 'Control type, enabled state and InvokePattern must match');
  }
  const controlBounds = rect(node);
  if (
    node.isOffscreen !== false ||
    !contains(rootBounds, controlBounds) ||
    !monitors.some((monitor) => contains(monitor, controlBounds)) ||
    ancestors.some(
      (ancestor) =>
        ancestor.isOffscreen !== false ||
        ancestor.isEnabled === false ||
        !contains(rect(ancestor), controlBounds),
    )
  ) {
    fail('TARGET_NOT_VISIBLE', 'The selected control and its ancestors must be visible on a monitor');
  }
  return {
    selector: request.selector,
    controlType: request.expectedControlType,
    bounds: controlBounds,
    isEnabled: true as const,
    isVisible: true as const,
    isInvokable: true as const,
  };
}

/** No evidence cache or replay: every call must gather fresh observations. */
export async function previewDesktopAction(
  input: DesktopActionPreviewRequest,
  dependencies: DesktopActionGuardDependencies,
) {
  const request = validateRequest(input);
  if (
    typeof dependencies?.executeReadOnly !== 'function' ||
    typeof dependencies?.observeDesktop !== 'function'
  ) {
    fail('MISSING_READ_ONLY_PROVIDERS', 'Both read-only UIA and native desktop observers must be injected');
  }
  if (dependencies.now !== undefined && typeof dependencies.now !== 'function') {
    fail('INVALID_CLOCK', 'A valid clock is required');
  }
  const now = dependencies.now ?? Date.now;
  const startedAtMs = now();
  if (!Number.isSafeInteger(startedAtMs) || startedAtMs < 0)
    fail('INVALID_CLOCK', 'A valid clock is required');
  let previousNow = startedAtMs;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < previousNow || value - startedAtMs > MAX_PREVIEW_MS) {
      fail('STALE_EVIDENCE', 'Preview exceeded its freshness window or the clock moved backwards');
    }
    previousNow = value;
    return value;
  };
  // Provider errors are sanitized; no raw tree, incidental window text or command output escapes.
  const observe = async () => {
    let observation: unknown;
    try {
      observation = await dependencies.observeDesktop(request.target);
    } catch {
      fail('DESKTOP_OBSERVATION_FAILED', 'Independent read-only desktop observation failed');
    }
    return snapshot(observation);
  };
  const before = await observe();
  const initial = assertDesktop(before, request.target, clock(), startedAtMs);
  let rawUia: unknown;
  const inspectionStartedAtMs = clock();
  try {
    rawUia = await dependencies.executeReadOnly({
      operation: 'inspect',
      pid: request.target.pid,
      hwnd: request.target.hwnd,
      process: request.target.process,
      title: request.target.title,
      depth: 4,
    });
  } catch {
    fail('UIA_INSPECTION_FAILED', 'Fresh read-only WinApp inspection failed');
  }
  const uia = snapshot(rawUia);
  const inspectionCompletedAtMs = clock();
  const control = assertUia(uia, request, initial.bounds, initial.monitors);
  const after = await observe();
  const completedAtMs = clock();
  const final = assertDesktop(after, request.target, completedAtMs, inspectionCompletedAtMs);
  if (completedAtMs - inspectionStartedAtMs > MAX_AGE_MS) {
    fail('STALE_EVIDENCE', 'UIA inspection is too old to preview');
  }
  if (JSON.stringify(initial) !== JSON.stringify(final)) {
    fail('GEOMETRY_CHANGED', 'Window or monitor geometry changed during the inspection');
  }
  return {
    schemaVersion: 1 as const,
    ok: true as const,
    readOnly: true as const,
    previewOnly: true as const,
    executed: false as const,
    executable: false as const,
    requestId: request.requestId,
    target: request.target,
    plan: { action: 'invoke' as const, mechanism: 'UIAutomation.InvokePattern' as const, control },
    evidence: {
      backend: 'Microsoft.WinAppCli' as const,
      version: '0.7.1' as const,
      startedAtMs,
      inspectionStartedAtMs,
      inspectionCompletedAtMs,
      completedAtMs,
      desktopObservedAtMs: [before.observedAtMs, after.observedAtMs],
      sessionId: request.target.sessionId,
      windowStation: 'WinSta0' as const,
      inputDesktop: 'Default' as const,
      foreground: true as const,
      windowBounds: final.bounds,
      monitors: final.monitors,
    },
    requiresFreshExecutionValidation: true as const,
  };
}
