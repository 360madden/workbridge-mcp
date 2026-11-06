// Investigation-only pure snapshot parity normalizer. No Win32/MCP/GUI/process/file I/O.
// Inputs: EPHEMERAL provider trees, pinned-source receipts, native before/after proofs.
// Public output: fixed sanitized numbers, hashes and status; never raw UIA Name/Value/Text.
import { createHash } from 'node:crypto';

const hex = (x) => typeof x === 'string' && /^[a-f0-9]{64}$/i.test(x);
const dec = (x) => typeof x === 'string' && /^[1-9][0-9]{0,18}$/.test(x);
const int = (x) => Number.isSafeInteger(x) && x >= 0;
const id = (x) => typeof x === 'string' && /^[a-z0-9][a-z0-9_-]{7,63}$/.test(x);
const sha = (x) => createHash('sha256').update(x).digest('hex');
function canonical(value, depth = 0) {
  if (depth > 12) fail('ARTIFACT_CANONICALIZATION_UNKNOWN');
  if (Array.isArray(value)) return '[' + value.map(v => canonical(v, depth + 1)).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k =>
      JSON.stringify(k) + ':' + canonical(value[k], depth + 1)).join(',') + '}';
  }
  const encoded = JSON.stringify(value);
  if (typeof encoded !== 'string') fail('ARTIFACT_CANONICALIZATION_UNKNOWN');
  return encoded;
}
const TITLE = 'Workbridge GUI-004 Native Input Probe';
const EPOCH = 621355968000000000n;
const EXPECTED = Object.freeze({ IncrementButton: 'Button', ResetButton: 'Button', CounterDisplay: 'Text' });
export const SOURCE_PINS = Object.freeze({
  winapp: Object.freeze({
    adapter: 'ed02a9b7c04e685f594237bf403d55d49daa502a93c59e65175118924eaf08a6',
    observer: '52d88949de768caa9e9df129840bcb28a39b1dc05263d511cacd209ccdfc72de',
    provider: 'Microsoft.WinAppCli', version: '0.7.1'
  }),
  sbroenne: Object.freeze({
    adapter: '2208e47660727bc619406917fadcf89af3ebd29d724ec9d5d2f1b3ce3c4414cf',
    observer: '50ed06c93a64dd79c2e6e2ba1a1fb614dade642e2328979dc700f4923bb0228b',
    binary: 'ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128',
    version: 'v1.3.28+655b9fc92d03ad52a270067c6844ea1231c90559'
  })
});

export class SnapshotParityError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new SnapshotParityError(code); }
function timestamp(x) {
  if (typeof x !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(x))
    fail('TIME_UNVERIFIED');
  const ms = Date.parse(x);
  if (!Number.isSafeInteger(ms)) fail('TIME_UNVERIFIED');
  return ms;
}
function msSinceEpoch(ticks) {
  if (!dec(ticks) || ticks.length < 17) fail('PROCESS_START_UNKNOWN');
  const ms = (BigInt(ticks) - EPOCH) / 10000n;
  if (ms < 0n || ms > BigInt(Number.MAX_SAFE_INTEGER)) fail('PROCESS_START_UNKNOWN');
  return Number(ms);
}
function validRect(r) {
  return r && ['left', 'top', 'right', 'bottom', 'width', 'height'].every(k =>
    Number.isSafeInteger(r[k]) && Math.abs(r[k]) <= 50000) &&
    r.width >= 300 && r.height >= 200 &&
    r.right - r.left === r.width && r.bottom - r.top === r.height;
}
function knownManifest(m) {
  if (!m || m.schemaVersion !== 1 || !id(m.runId) || m.requestId !== m.runId ||
      !id(m.leaseId) || !int(m.pid) || !m.pid || !int(m.sessionId) || !m.sessionId ||
      !int(m.watchdogPid) || !m.watchdogPid || !dec(m.hwnd) || !dec(m.foregroundHwnd) ||
      !dec(m.startedAtUtcTicks) || !dec(m.watchdogStartedAtUtcTicks) ||
      !/^S-[0-9]+-[0-9]+(-[0-9]+)+$/.test(m.ownerSid ?? '') ||
      m.title !== TITLE || typeof m.className !== 'string' ||
      !/^WindowsForms10\.Window\./.test(m.className) || m.className.length > 220 ||
      !hex(m.exeSha256) || m.jobActiveAfterSpawn !== 2)
    fail('TARGET_IDENTITY_MISSING');
  const birth = msSinceEpoch(m.startedAtUtcTicks);
  const observed = timestamp(m.observedAtUtc);
  const deadline = timestamp(m.deadlineUtc);
  if (birth > observed + 1000 || observed > deadline || deadline - birth > 120000)
    fail('TARGET_TIME_UNTRUSTED');
  return { birth, observed, deadline };
}
function knownLease(lock, m) {
  if (!lock || lock.schemaVersion !== 1 || lock.kind !== 'workbridge.gui-turn' ||
      lock.producer !== 'desktopprobe-watchdog' ||
      lock.runId !== m.runId || lock.requestId !== m.requestId ||
      lock.leaseId !== m.leaseId || lock.owner?.pid !== m.watchdogPid ||
      lock.owner?.processStartUtcTicks !== m.watchdogStartedAtUtcTicks ||
      lock.owner?.sessionId !== m.sessionId || lock.target?.kind !== 'window' ||
      lock.target.pid !== null || lock.target.hwnd !== null ||
      lock.target.process !== 'DesktopProbe')
    fail('LEASE_UNKNOWN_OR_MISMATCHED');
}
function knownSource(source, provider, manifest, lease) {
  const pin = SOURCE_PINS[provider];
  if (!source || source.adapterSha256 !== pin.adapter ||
      source.nativeObserverSha256 !== pin.observer ||
      !hex(source.manifestReceiptSha256) || !hex(source.leaseReceiptSha256) ||
      source.manifestCanonicalSha256 !== sha(canonical(manifest)) ||
      source.leaseCanonicalSha256 !== sha(canonical(lease)) ||
      !hex(source.observedBinarySha256) || !hex(source.approvedBinarySha256) ||
      source.observedBinarySha256.toLowerCase() !== source.approvedBinarySha256.toLowerCase())
    fail('PINNED_SOURCE_NOT_PROVEN');
  if (pin.binary && source.observedBinarySha256.toLowerCase() !== pin.binary)
    fail('PINNED_SOURCE_NOT_PROVEN');
  // Hash values are *externally attested claims*: a pure function cannot inspect files.
}
function oracleState(phase, m, expectedSource, requireWatchdog = true) {
  const r = phase?.observation;
  if (!phase || !hex(phase.receiptSha256) || !r || r.schemaVersion !== 1 ||
      r.verified !== true || r.ownerSidVerified !== true ||
      (requireWatchdog && r.watchdogOwnerVerified !== true) ||
      r.watchdogOwnerVerified === false ||
      r.pid !== m.pid || r.startedAtUtcTicks !== m.startedAtUtcTicks ||
      r.sessionId !== m.sessionId || r.hwnd !== m.hwnd || r.rootHwnd !== m.hwnd ||
      r.ownerHwnd !== '0' || r.className !== m.className ||
      r.foregroundHwnd !== m.foregroundHwnd ||
      r.windowStation !== 'WinSta0' || r.desktopName !== 'Default' ||
      !validRect(r.rect) || r.journal?.shown !== true || r.journal?.eventCount !== 2 ||
      r.journal?.counter !== 0 || r.journal?.unexpectedInputEvents !== 0 ||
      !hex(r.journal.sha256) || phase.observerSha256 !== expectedSource)
    fail('NATIVE_ORACLE_MISSING_OR_DRIFTED');
  // Discard all additional fields (including any arbitrary UI text).
  return {
    hash: sha(JSON.stringify([
      r.pid, r.startedAtUtcTicks, r.sessionId, r.hwnd, r.rootHwnd, r.ownerHwnd,
      r.className, r.foregroundHwnd, r.windowStation, r.desktopName,
      [r.rect.left, r.rect.top, r.rect.right, r.rect.bottom, r.rect.width, r.rect.height],
      r.journal.sha256.toLowerCase(), r.journal.counter, r.journal.unexpectedInputEvents
    ])),
    journal: r.journal.sha256.toLowerCase(),
    at: timestamp(phase.observedAtUtc)
  };
}
function providerTree(provider, sourceTree) {
  if (!sourceTree || typeof sourceTree !== 'object' ||
      sourceTree.suppressed === true || sourceTree.truncated === true ||
      sourceTree.partial === true || sourceTree.incomplete === true)
    fail('RAW_TREE_MISSING_OR_SUPPRESSED');
  const a = provider === 'winapp';
  let roots;
  if (a) {
    const windows = sourceTree.windows;
    if (!Array.isArray(windows) || windows.length !== 1 || !Array.isArray(windows[0]?.elements))
      fail('RAW_TREE_SHAPE_UNKNOWN');
    roots = windows[0].elements;
  } else {
    if (sourceTree.success !== true || sourceTree.action !== 'get_tree' ||
        sourceTree.kind !== 'full' || sourceTree.snapshotIncomplete === true ||
        !Array.isArray(sourceTree.tree))
      fail('RAW_TREE_SHAPE_UNKNOWN');
    roots = sourceTree.tree;
  }
  if (roots.length < 1 || roots.length > 100) fail('RAW_TREE_SHAPE_UNKNOWN');
  const counts = { IncrementButton: 0, ResetButton: 0, CounterDisplay: 0 };
  const normalizedTypes = { IncrementButton: 'Button', ResetButton: 'Button', CounterDisplay: 'Text' };
  const winappShape = [];
  const typedIdShape = [];
  let nodes = 0, maxDepth = 0;
  function walk(node, depth) {
    if (!node || typeof node !== 'object' || Array.isArray(node) ||
        typeof node.type !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(node.type) ||
        depth > (a ? 6 : 2) || nodes >= (a ? 4096 : 2048))
      fail('TREE_TYPE_DEPTH_OR_SIZE_UNKNOWN');
    if (node.suppressed === true || node.truncated === true || node.incomplete === true ||
        node.childrenSuppressed === true || node.moreChildren === true || node.hasMore === true)
      fail('RAW_TREE_MISSING_OR_SUPPRESSED');
    const children = node.children ?? [];
    if (!Array.isArray(children) || children.length > 1024) fail('TREE_TYPE_DEPTH_OR_SIZE_UNKNOWN');
    const type = node.type;
    const elementId = a ? node.selector : node.automationId;
    // Hash only allowlisted fixture IDs, never arbitrary names/values/other automation IDs.
    const knownId = Object.hasOwn(counts, elementId) ? elementId : null;
    typedIdShape.push([depth, type, knownId, children.length]);
    // Count ALL expected-ID occurrences, including wrong types, before deciding typed uniqueness.
    if (Object.hasOwn(counts, elementId)) {
      counts[elementId] += 1;
      const valid = a
        ? (elementId === 'CounterDisplay' ? ['text', 'label'].includes(type.toLowerCase())
          : type.toLowerCase() === 'button')
        : type === EXPECTED[elementId];
      if (!valid) fail('CONTROL_TYPE_AMBIGUOUS');
    }
    nodes += 1; maxDepth = Math.max(maxDepth, depth);
    if (a) winappShape.push([depth, type.toLowerCase(), children.length]);
    const nested = children.map(child => walk(child, depth + 1));
    return [type, nested];
  }
  const sbroenneShape = roots.map(root => walk(root, 0));
  if (Object.values(counts).some(n => n !== 1)) fail('CONTROLS_MISSING_DUPLICATED_OR_AMBIGUOUS');
  const digest = sha(JSON.stringify(a ? winappShape : sbroenneShape));
  return { nodes, maxDepth, structuralSha256: digest,
    typedIdStructuralSha256: sha(JSON.stringify(typedIdShape)), controls: normalizedTypes };
}
function knownReceipt(r, provider, sampleId, m, tree) {
  if (!r || r.schemaVersion !== 1 || r.sampleId !== sampleId ||
      (provider === 'winapp' && (r.provider !== SOURCE_PINS.winapp.provider ||
        r.backendVersion !== SOURCE_PINS.winapp.version || r.result !== 'success' ||
        r.reasonCode !== 'UIA_READ_ONLY_VERIFIED' || r.readOnly !== true ||
        r.actualInputActions !== 0 || r.screenshots !== 0 || r.target?.pid !== m.pid ||
        r.target?.startedAtUtcTicks !== m.startedAtUtcTicks || r.target?.sessionId !== m.sessionId ||
        r.target?.hwnd !== m.hwnd)) ||
      (provider === 'sbroenne' && (r.provider !== 'sbroenne-restricted-mcp-v5' ||
        r.state !== 'success' || r.code !== 'READONLY_SNAPSHOT_VERIFIED' ||
        r.backendVersion !== SOURCE_PINS.sbroenne.version ||
        r.sourceHash !== SOURCE_PINS.sbroenne.binary || r.targetPid !== m.pid ||
        r.targetHwnd !== m.hwnd || r.processTreeSettlement !== 'native-host-required')))
    fail('PROVIDER_RECEIPT_NOT_VERIFIED');
  const t = r.tree;
  if (!t || t.fixtureControlsVerified !== true || t.nodes !== tree.nodes ||
      t.maxDepth !== tree.maxDepth || !hex(t.structuralSha256) ||
      t.structuralSha256.toLowerCase() !== tree.structuralSha256 ||
      !int(t.payloadBytes) || t.payloadBytes < 2 ||
      t.payloadBytes > (provider === 'winapp' ? 393216 : 262144) ||
      (provider === 'sbroenne' && (t.fixtureControlCount !== 3 ||
        t.kind !== 'full' || t.incomplete === true)))
    fail('PROJECTED_TREE_NOT_VERIFIED');
  const v = r.latencyMs;
  if (!v || !Number.isFinite(v.total) || v.total < 0 ||
      !Number.isFinite(provider === 'winapp' ? v.inspect : v.discoverOrSnapshot) ||
      (provider === 'winapp' ? v.inspect : v.discoverOrSnapshot) < 0)
    fail('PROVIDER_TIMING_NOT_VERIFIED');
  return { providerMs: provider === 'winapp' ? v.inspect : v.discoverOrSnapshot,
    totalMs: v.total, extraNativeObserver: provider === 'sbroenne' };
}
function knownDispatch(dispatch, m, provider, times) {
  if (!dispatch || dispatch.targetPid !== m.pid || dispatch.targetHwnd !== m.hwnd ||
      dispatch.depth !== 1 ||
      (provider === 'winapp' && dispatch.operation !== 'inspect') ||
      (provider === 'sbroenne' && (dispatch.operation !== 'ui_snapshot' ||
        dispatch.mode !== 'full' || dispatch.includeDiagnostics !== false)))
    fail('EXPLICIT_TARGET_DISPATCH_MISSING');
  const at = timestamp(dispatch.atUtc);
  if (at < times.before || at > times.after ||
      times.deadline - at < (provider === 'sbroenne' ? 40000 : 15000))
    fail('DISPATCH_TIME_UNVERIFIED');
  return at;
}
function knownSupervisor(s, manifest, sampleId, provider, privateReceiptSha, witnessReceiptSha) {
  if (!s || s.schemaVersion !== 1 || s.provider !== provider ||
      s.runId !== manifest.runId || s.requestId !== manifest.requestId ||
      s.leaseId !== manifest.leaseId || s.sampleId !== sampleId ||
      s.targetPid !== manifest.pid || s.targetStartUtcTicks !== manifest.startedAtUtcTicks ||
      s.targetSessionId !== manifest.sessionId || s.targetHwnd !== manifest.hwnd ||
      s.watchdogPid !== manifest.watchdogPid ||
      s.watchdogStartUtcTicks !== manifest.watchdogStartedAtUtcTicks ||
      !int(s.ownerPid) || !s.ownerPid || !dec(s.ownerStartUtcTicks) ||
      !int(s.childPid) || !s.childPid || !dec(s.childStartUtcTicks) ||
      s.childSessionId !== manifest.sessionId ||
      s.providerReceiptSha256 !== privateReceiptSha ||
      s.strictWitnessReceiptSha256 !== witnessReceiptSha ||
      s.processTreeSettled !== true || s.privateJobEmpty !== true ||
      s.jobMemberCountAfter !== 0 || s.completeMemberListVerified !== true ||
      s.exitCode !== 0 || !hex(s.receiptSha256) || s.ownerIdentityVerified !== true)
    fail('PROCESS_SETTLEMENT_UNKNOWN_OR_FOREIGN');
}
function knownTypedWitness(w, sample, tree, dispatchAt, after) {
  const m = sample.manifest;
  if (!w || w.schemaVersion !== 1 || w.provider !== sample.provider ||
      w.runId !== m.runId || w.requestId !== m.requestId ||
      w.leaseId !== m.leaseId || w.sampleId !== sample.sampleId ||
      w.targetPid !== m.pid || w.targetStartUtcTicks !== m.startedAtUtcTicks ||
      w.targetSessionId !== m.sessionId || w.targetHwnd !== m.hwnd ||
      w.producerAdapterSha256 !== SOURCE_PINS[sample.provider].adapter ||
      w.providerBinarySha256 !== sample.source.observedBinarySha256 ||
      w.producerPid !== sample.supervisor?.childPid ||
      w.producerStartUtcTicks !== sample.supervisor?.childStartUtcTicks ||
      w.typedIdStructuralSha256 !== tree.typedIdStructuralSha256 ||
      w.manifestCanonicalSha256 !== sample.source.manifestCanonicalSha256 ||
      w.leaseCanonicalSha256 !== sample.source.leaseCanonicalSha256 ||
      w.privateReceiptSha256 !== sample.privateReceiptSha256 ||
      w.captureCompleteness !== 'full' || w.ambiguous !== false ||
      w.suppressed !== false || w.notReplayed !== true ||
      !hex(w.witnessReceiptSha256))
    fail('TYPED_ID_WITNESS_MISSING_UNBOUND_OR_AMBIGUOUS');
  const t = timestamp(w.observedAtUtc);
  if (t < dispatchAt || t > after.at) fail('TYPED_ID_WITNESS_TIME_UNVERIFIED');
  // The witness is a caller-attested, sample-bound commitment from the pinned
  // provider-time adapter. This pure model cannot itself authenticate producers.
  return w.witnessReceiptSha256;
}
export function typedIdWitnessDigest(provider, rawEphemeralTree) {
  if (!SOURCE_PINS[provider]) fail('UNRECOGNIZED_PROVIDER');
  return providerTree(provider, rawEphemeralTree).typedIdStructuralSha256;
}
function unknown(provider, reason) {
  return Object.freeze({ schemaVersion: 1, provider,
    status: 'unknown_outcome', reasonCode: reason, controls: null,
    targetFingerprint: null, nativeStateSha256: null, journalSha256: null,
    tree: null, latencyMs: null });
}
export function normalizeReadOnlySnapshot(sample) {
  const provider = sample?.provider;
  if (provider !== 'winapp' && provider !== 'sbroenne')
    return unknown('unknown', 'UNRECOGNIZED_PROVIDER');
  try {
    const m = sample.manifest;
    const t = knownManifest(m);
    knownLease(sample.lease, m);
    knownSource(sample.source, provider, m, sample.lease);
    if (!id(sample.sampleId) || sample.readOnly !== true ||
        sample.actualInputActions !== 0 || sample.screenshots !== 0 ||
        !hex(sample.privateReceiptSha256)) fail('SAMPLE_EVIDENCE_INCOMPLETE');
    const before = oracleState(sample.native?.before, m, SOURCE_PINS[provider].observer,
      provider === 'sbroenne');
    const after = oracleState(sample.native?.after, m, SOURCE_PINS[provider].observer,
      provider === 'sbroenne');
    const pre = provider === 'sbroenne'
      ? oracleState(sample.native?.preDispatch, m, SOURCE_PINS[provider].observer)
      : null;
    // WinApp's existing oracle cannot prove watchdog process identity. Require
    // an additional independently pinned dual-target+watchdog native witness.
    const witness = provider === 'winapp'
      ? oracleState(sample.watchdogWitness, m, SOURCE_PINS.sbroenne.observer)
      : null;
    if (before.hash !== after.hash || (pre && pre.hash !== before.hash) ||
        (witness && witness.hash !== before.hash))
      fail('NATIVE_STATE_CHANGED');
    if (before.at < t.observed - 1000 || before.at < t.birth - 1000 ||
        before.at - t.birth > 65000 || after.at < before.at || after.at > t.deadline ||
        after.at - before.at > 90000 || (pre && (pre.at < before.at || pre.at > after.at)) ||
        (witness && (witness.at < before.at || witness.at > after.at)))
      fail('TARGET_TIME_UNVERIFIED');
    const admission = timestamp(sample.admittedAtUtc);
    if (admission < t.observed - 1000 || admission < t.birth - 1000 ||
        admission > before.at || t.deadline - admission < (provider === 'sbroenne' ? 80000 : 30000))
      fail('ADMISSION_BUDGET_UNVERIFIED');
    const at = knownDispatch(sample.dispatch, m, provider,
      { before: pre?.at ?? before.at, after: after.at, deadline: t.deadline });
    if ((pre && at < pre.at) ||
        (witness && (witness.at > at || at - witness.at > 2000)))
      fail('NATIVE_WITNESS_TIME_UNVERIFIED');
    const tree = providerTree(provider, sample.rawTree);
    const timing = knownReceipt(sample.receipt, provider, sample.sampleId, m, tree);
    const witnessReceiptSha = knownTypedWitness(sample.strictTypedWitness, sample, tree, at, after);
    knownSupervisor(sample.supervisor, m, sample.sampleId, provider,
      sample.privateReceiptSha256, witnessReceiptSha);
    const targetFingerprint = sha(JSON.stringify([
      m.runId, m.requestId, m.leaseId, m.pid, m.startedAtUtcTicks, m.sessionId,
      m.hwnd, m.className, m.exeSha256.toLowerCase(), m.foregroundHwnd,
      m.watchdogPid, m.watchdogStartedAtUtcTicks, m.ownerSid
    ]));
    return Object.freeze({
      schemaVersion: 1, provider, status: 'verified_readonly_snapshot',
      reasonCode: 'STRICT_CONTROLS_NATIVE_AND_SETTLEMENT_VERIFIED',
      targetFingerprint, nativeStateSha256: before.hash,
      journalSha256: before.journal,
      controls: tree.controls,
      tree: { nodes: tree.nodes, maxDepth: tree.maxDepth,
        providerSpecificStructuralSha256: tree.structuralSha256 },
      latencyMs: timing
    });
  } catch (error) {
    return unknown(provider, error instanceof SnapshotParityError
      ? error.code : 'UNCLASSIFIED_EVIDENCE_FAILURE');
  }
}
export function compareReadOnlySnapshots(winappSample, sbroenneSample) {
  const a = normalizeReadOnlySnapshot(winappSample);
  const b = normalizeReadOnlySnapshot(sbroenneSample);
  if (a.provider !== 'winapp' || b.provider !== 'sbroenne' ||
      a.status !== 'verified_readonly_snapshot' ||
      b.status !== 'verified_readonly_snapshot')
    return Object.freeze({ schemaVersion: 1, status: 'unknown_outcome',
      reasonCode: 'ONE_OR_BOTH_SNAPSHOT_PROOFS_UNKNOWN',
      winapp: a, sbroenne: b, parity: null });
  if (a.targetFingerprint !== b.targetFingerprint ||
      a.nativeStateSha256 !== b.nativeStateSha256 ||
      a.journalSha256 !== b.journalSha256)
    return Object.freeze({ schemaVersion: 1, status: 'unknown_outcome',
      reasonCode: 'PAIRED_NATIVE_TARGET_OR_STATE_MISMATCH',
      winapp: a, sbroenne: b, parity: null });
  const countsEqual = a.tree.nodes === b.tree.nodes &&
    a.tree.maxDepth === b.tree.maxDepth;
  return Object.freeze({
    schemaVersion: 1, status: 'verified_control_parity',
    reasonCode: countsEqual ? 'TYPED_CONTROLS_AND_COUNTS_AGREE' :
      'TYPED_CONTROLS_AGREE_PROVIDER_TREE_SHAPES_DIFFER',
    winapp: a, sbroenne: b,
    parity: { typedControls: 'verified', structuralCounts: countsEqual ? 'same' : 'different',
      structuralHashesComparable: false, nativeStateUnchanged: true,
      providerOnlyLatencyComparableWithCaveats: true,
      endToEndLatencyDirectlyComparable: false }
  });
}
