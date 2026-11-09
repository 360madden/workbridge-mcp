// Disposable-only phase monitor. Read-only polling after exactly one independently sent key/text event.
// The caller owns its GUI lease and exclusively decides whether a subsequent stage is permissible.
const EXPECTED_TEXT_LENGTH = 9;

export class ChatProbePhaseError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ChatProbePhaseError';
    this.code = code;
  }
}
function fail(code, message) {
  throw new ChatProbePhaseError(code, message);
}

export function assessNativeChatPhase(events, phase) {
  if (!['opened', 'typed', 'submitted'].includes(phase))
    fail('INVALID_PHASE', 'Unknown disposable chat phase');
  if (
    !Array.isArray(events) ||
    events.some((x) => !x || typeof x !== 'object' || typeof x.stage !== 'string')
  ) {
    fail('INVALID_NATIVE_EVENTS', 'Native event log was not a bounded array');
  }
  if (events.length > 60 || events.some((x) => x.stage === 'unexpected' || x.stage === 'error')) {
    fail('UNEXPECTED_NATIVE_EVENT', 'Native probe received unexpected input or an error');
  }
  const opened = events.filter((x) => x.stage === 'opened');
  const typed = events.filter((x) => x.stage === 'typed');
  const submitted = events.filter((x) => x.stage === 'submitted');
  if (opened.length > 1 || submitted.length > 1 || (opened.length === 1 && opened[0].chatOpen !== true)) {
    fail('DUPLICATE_NATIVE_EVENT', 'Duplicate chat-open or submission observed');
  }
  for (let i = 0; i < typed.length; i += 1) {
    if (
      Number(typed[i].typedLength) !== i + 1 ||
      (i === EXPECTED_TEXT_LENGTH - 1 ? typed[i].matchedExpected !== true : typed[i].matchedExpected === true)
    ) {
      fail('UNEXPECTED_NATIVE_EVENT', 'Typed character sequence or exact-command marker changed');
    }
  }
  if (typed.length > EXPECTED_TEXT_LENGTH) fail('DUPLICATE_NATIVE_EVENT', 'More than nine typed characters');
  if (
    submitted.length === 1 &&
    (submitted[0].matchedExpected !== true || submitted[0].typedLength !== EXPECTED_TEXT_LENGTH)
  ) {
    fail('WRONG_SUBMISSION', 'Native probe submitted unexpected text');
  }
  if (phase === 'opened') {
    if (typed.length || submitted.length) fail('PHASE_ADVANCED', 'Input advanced beyond newly opened chat');
    return { satisfied: opened.length === 1, typedCount: 0 };
  }
  if (phase === 'typed') {
    if (opened.length !== 1) fail('MISSING_OPEN', 'Text arrived before chat-open evidence');
    if (submitted.length) fail('PHASE_ADVANCED', 'Text was submitted before explicit final Enter');
    return { satisfied: typed.length === EXPECTED_TEXT_LENGTH, typedCount: typed.length };
  }
  if (opened.length !== 1 || typed.length !== EXPECTED_TEXT_LENGTH) {
    return { satisfied: false, typedCount: typed.length };
  }
  return { satisfied: submitted.length === 1, typedCount: typed.length };
}

export async function waitForNativeChatPhase({
  phase,
  readEvents,
  timeoutMs = 3000,
  intervalMs = 40,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  if (typeof readEvents !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') {
    fail('INVALID_MONITOR', 'Phase poller needs bounded read-only dependencies');
  }
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 5000 ||
    !Number.isSafeInteger(intervalMs) ||
    intervalMs < 10 ||
    intervalMs > 500
  ) {
    fail('INVALID_MONITOR', 'Poll duration or interval outside bounded limits');
  }
  const deadline = now() + timeoutMs;
  while (true) {
    const events = await readEvents();
    const observed = assessNativeChatPhase(events, phase);
    if (observed.satisfied) return observed;
    if (now() >= deadline)
      fail('PHASE_NOT_OBSERVED', 'Native event not observed before deadline; do not resend input');
    await sleep(intervalMs);
  }
}

export async function sendDisposableChatPhaseOnce({
  phase,
  assertTarget,
  sendExactlyOnce,
  readEvents,
  ...pollOptions
}) {
  if (typeof assertTarget !== 'function' || typeof sendExactlyOnce !== 'function') {
    fail('INVALID_SENDER', 'No verified target or one-shot sender supplied');
  }
  await assertTarget();
  const response = await sendExactlyOnce();
  const verified = await waitForNativeChatPhase({ phase, readEvents, ...pollOptions });
  return { response, verified };
}
