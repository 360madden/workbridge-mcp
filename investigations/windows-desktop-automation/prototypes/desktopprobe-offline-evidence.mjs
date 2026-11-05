// Pure, bounded, investigation-only DesktopProbe evidence classifier.
// No process enumeration, filesystem access, UIA call, focus, input or screenshots.
// Reuse the WinApp sampler's existing schema/identity validators.
import { createHash } from 'node:crypto';
import {
  validateManifest, validateLease, validateObserver, sameOracle,
} from './winapp-desktopprobe-sample.mjs';

const MAX_JSON = 8192;
const MAX_JOURNAL = 65536;
const TITLE = 'Workbridge GUI-004 Native Input Probe';
const CODES = Object.freeze({ PASS: 'PASS', FAIL: 'FAIL', UNKNOWN: 'UNKNOWN' });

class Verdict extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function fail(code) { throw new Verdict(CODES.FAIL, code); }
function unknown(code) { throw new Verdict(CODES.UNKNOWN, code); }
function result(status, reasonCode, evidence = {}) {
  return {
    schemaVersion: 1, status, reasonCode, readOnly: true,
    evidence: {
      manifest: evidence.manifest === true,
      lease: evidence.lease === true,
      before: evidence.before === true,
      after: evidence.after === true,
      journal: evidence.journal === true,
      unchangedForeground: evidence.unchangedForeground === true,
      unchangedCounter: evidence.unchangedCounter === true,
    },
  };
}

function objectArtifact(value, name) {
  if (value === null || value === undefined) unknown('MISSING_' + name);
  let decoded = value;
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_JSON) fail(name + '_TOO_LARGE');
    try { decoded = JSON.parse(value); } catch { fail(name + '_MALFORMED'); }
  }
  if (!decoded || Array.isArray(decoded) || typeof decoded !== 'object') fail(name + '_INVALID');
  try {
    if (Buffer.byteLength(JSON.stringify(decoded), 'utf8') > MAX_JSON) fail(name + '_TOO_LARGE');
  } catch (error) {
    if (error instanceof Verdict) throw error;
    fail(name + '_INVALID');
  }
  return decoded;
}

function unknownForeground(value) {
  return value === undefined || value === null || value === '' ||
    value === '0' || value === 'unknown' || value === 'UNKNOWN';
}

export function parseNativeJournal(value) {
  if (value === null || value === undefined) unknown('MISSING_NATIVE_JOURNAL');
  const buffer = Buffer.isBuffer(value) ? value
    : value instanceof Uint8Array ? Buffer.from(value)
      : typeof value === 'string' ? Buffer.from(value, 'utf8') : null;
  if (!buffer || buffer.length < 16 || buffer.length > MAX_JOURNAL) fail('NATIVE_JOURNAL_INVALID');
  const lines = buffer.toString('utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.length !== 2) fail('JOURNAL_EVENT_COUNT_CHANGED');
  let starting, shown;
  try {
    starting = JSON.parse(lines[0]);
    shown = JSON.parse(lines[1]);
  } catch { fail('NATIVE_JOURNAL_MALFORMED'); }
  if (!starting || !shown || starting.schemaVersion !== 1 || shown.schemaVersion !== 1 ||
      starting.stage !== 'starting' || shown.stage !== 'shown') {
    fail('JOURNAL_SEQUENCE_CHANGED');
  }
  return {
    records: [starting, shown],
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}

export function classifyDesktopProbeEvidence(artifacts) {
  const checked = {
    manifest: false, lease: false, before: false, after: false,
    journal: false, unchangedForeground: false, unchangedCounter: false,
  };
  try {
    if (!artifacts || typeof artifacts !== 'object') unknown('MISSING_EVIDENCE');
    const manifest = objectArtifact(artifacts.manifest, 'MANIFEST');
    if (unknownForeground(manifest.foregroundHwnd)) unknown('FOREGROUND_UNKNOWN');
    validateManifest(manifest);
    if (manifest.requestId !== manifest.runId) fail('REQUEST_ID_RUN_MISMATCH');
    checked.manifest = true;

    const lease = objectArtifact(artifacts.lease, 'LEASE');
    validateLease(lease, manifest);
    checked.lease = true;

    const before = objectArtifact(artifacts.before, 'BEFORE');
    const after = objectArtifact(artifacts.after, 'AFTER');
    if (unknownForeground(before.foregroundHwnd) || unknownForeground(after.foregroundHwnd)) {
      unknown('FOREGROUND_UNKNOWN');
    }

    // Raw journal must exist and agree with native observer SHA; absence is inconclusive.
    const journal = parseNativeJournal(artifacts.nativeJournal);
    const [startEvent, shownEvent] = journal.records;
    if (startEvent.pid !== manifest.pid || shownEvent.pid !== manifest.pid ||
        startEvent.sessionId !== manifest.sessionId || shownEvent.sessionId !== manifest.sessionId ||
        startEvent.hwnd !== 0 || String(shownEvent.hwnd) !== manifest.hwnd ||
        startEvent.title !== TITLE || shownEvent.title !== TITLE ||
        startEvent.error !== null || shownEvent.error !== null) {
      fail('JOURNAL_TARGET_IDENTITY_CHANGED');
    }
    if (startEvent.counter !== 0 || shownEvent.counter !== 0) fail('JOURNAL_COUNTER_CHANGED');
    checked.journal = true;
    checked.unchangedCounter = true;

    validateObserver(before, manifest);
    checked.before = true;
    validateObserver(after, manifest);
    checked.after = true;
    if (before.journal.sha256 !== journal.sha256 || after.journal.sha256 !== journal.sha256) {
      fail('JOURNAL_HASH_DID_NOT_MATCH_ORACLE');
    }
    sameOracle(before, after);
    checked.unchangedForeground = true;
    return result(CODES.PASS, 'COMPLETE_READ_ONLY_IDENTITY', checked);
  } catch (error) {
    if (error instanceof Verdict) return result(error.status, error.code, checked);
    // Existing sampler validators throw a narrow uppercase code for disproven admission.
    const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(error.code)
      ? error.code : 'IDENTITY_EVIDENCE_INVALID';
    return result(CODES.FAIL, code, checked);
  }
}
