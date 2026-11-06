import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { validateWgcReceipt } from './receipt-validator.mjs';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc(bytes) {
  let c = -1;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(tag, body) {
  const label = Buffer.from(tag, 'ascii');
  const size = Buffer.alloc(4);
  size.writeUInt32BE(body.length, 0);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc(Buffer.concat([label, body])), 0);
  return Buffer.concat([size, label, body, checksum]);
}
function fakePng(raw = Buffer.from([0, 20, 180, 90, 255, 240, 120, 30, 255]), format = {}) {
  // Pure in-memory two-pixel RGBA fixture; no screenshots or GUI.
  const magic = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(2, 0);
  header.writeUInt32BE(1, 4);
  header[8] = format.bitDepth ?? 8;
  header[9] = format.colorType ?? 6;
  header[12] = format.interlace ?? 0;
  return Buffer.concat([magic, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const image = fakePng();
function pngWithDataChunks(dataChunks) {
  // IHDR occupies exactly 25 bytes after the PNG signature in this synthetic fixture.
  return Buffer.concat([image.subarray(0, 33), ...dataChunks, chunk('IEND', Buffer.alloc(0))]);
}
function replacePng(receipt, context, replacement) {
  context.pngBytes = replacement;
  receipt.artifact.sizeBytes = replacement.length;
  receipt.artifact.sha256 = sha(replacement);
}
function fixture() {
  const requestId = 'synthetic_wgc_receipt_20261105_01';
  const target = {
    pid: 12345, hwnd: 919191, startedUtc: '2026-11-06T00:03:00Z',
    sessionId: 2, process: 'rift_x64', title: 'RIFT',
    className: 'TWNClientFramework', ownerHwnd: 0
  };
  const source = {
    vendorPackage: 'Microsoft.Windows.SDK.BuildTools.WinApp.UIAutomation',
    vendorVersion: '0.7.1', applicationAssemblySha256: 'a'.repeat(64),
    lockedDependencyManifestSha256: 'b'.repeat(64),
    backendVerified: 'WGC-only', fallbackUsed: false, sourceCommit: 'c'.repeat(40)
  };
  const receipt = {
    kind: 'workbridge.physical-rift-wgc-capture-receipt', schemaVersion: 2,
    uniqueRequestId: requestId, target, source,
    timing: {
      captureBeginUtc: '2026-11-06T01:29:59.000Z',
      grabberCreatedMonotonicTicks: '100000',
      firstFrameObservedMonotonicTicks: '100300',
      firstFrameObservedUtc: '2026-11-06T01:29:59.500Z',
      captureEndUtc: '2026-11-06T01:29:59.900Z',
      maxFirstFrameWaitMs: 7000, frameVersion: 1
    },
    foreground: {
      beforeHwnd: 53535, afterHwnd: 53535,
      eventHookInstalled: true, eventHookCoverageComplete: true,
      foregroundChangeEventCount: 0,
      hookStartUtc: '2026-11-06T01:29:58.900Z',
      hookStopUtc: '2026-11-06T01:30:00.000Z',
      proofScope: 'instrumented-interval', observedUnchanged: true
    },
    frame: {
      width: 2, height: 1, colorVariation: true,
      frameSource: 'new-frame-from-new-grabber',
      mappingToPhysicalScreen: 'UNVERIFIED_UNTIL_SYNTHETIC_CALIBRATION'
    },
    artifact: {
      relativeEvidencePath: '.tools/desktop-evidence/capture-wgc-' + requestId + '.png',
      receiptPath: '.tools/desktop-evidence/capture-wgc-' + requestId + '.json',
      createExclusive: true, immutableReceipt: true,
      pngHeaderVerified: true, decodedDimensionsVerified: true,
      sha256: sha(image), sizeBytes: image.length
    },
    operation: {
      readOnly: true, inputInjected: false, focusAttempted: false,
      windowRestored: false, windowActivated: false,
      foregroundMayChange: false, liveRetryAllowed: false
    },
    settlement: {
      wrapperExitCode: 0, childExitCode: 0, timeout: false,
      unknownOutcome: false, postTargetIdentityMatches: true,
      receiptPngRehashMatches: true
    }
  };
  const context = {
    nowUtc: '2026-11-06T01:30:00.200Z',
    expectedTarget: structuredClone(target),
    expectedSource: {
      applicationAssemblySha256: source.applicationAssemblySha256,
      lockedDependencyManifestSha256: source.lockedDependencyManifestSha256,
      sourceCommit: source.sourceCommit
    },
    expectedRequestId: requestId,
    requestAlreadyConsumed: false,
    receiptComplete: true,
    pngBytes: image
  };
  return { receipt, context };
}
function reject(label, edit, code) {
  test(label, () => {
    const data = fixture();
    edit(data.receipt, data.context);
    assert.throws(() => validateWgcReceipt(data.receipt, data.context),
      (error) => error?.code === code, 'expected rejection: ' + code);
  });
}

test('positive synthetic v2 receipt is accepted as STRUCTURE ONLY', () => {
  const { receipt, context } = fixture();
  const checked = validateWgcReceipt(receipt, context);
  assert.equal(checked.ok, true);
  assert.equal(checked.liveRetryAllowed, false);
  assert.equal(checked.scope, 'OFFLINE_RECEIPT_CONSISTENCY_ONLY');
  assert.equal(checked.pngValidationScope, 'STRUCTURAL_CRC_INFLATE_ONLY');
  assert.equal(checked.independentPixelDecodeVerified, false);
  assert.equal(checked.pngWidth, 2);
  assert.equal(checked.pngHeight, 1);
});

test('positive signed Int64 minimum monotonic ticks accepted (1 then 2)', () => {
  const { receipt, context } = fixture();
  receipt.timing.grabberCreatedMonotonicTicks = '1';
  receipt.timing.firstFrameObservedMonotonicTicks = '2';
  assert.equal(validateWgcReceipt(receipt, context).ok, true);
});
test('positive signed Int64 maximum monotonic tick accepted', () => {
  const { receipt, context } = fixture();
  receipt.timing.grabberCreatedMonotonicTicks = '9223372036854775806';
  receipt.timing.firstFrameObservedMonotonicTicks = '9223372036854775807';
  assert.equal(validateWgcReceipt(receipt, context).ok, true);
});

test('Windows .NET 7-digit fractional UTC timestamps accepted without pixel proof', () => {
  const { receipt, context } = fixture();
  for (const [owner, key] of [[receipt.timing, 'captureBeginUtc'], [receipt.timing, 'firstFrameObservedUtc'],
                              [receipt.timing, 'captureEndUtc'], [receipt.foreground, 'hookStartUtc'],
                              [receipt.foreground, 'hookStopUtc'], [context, 'nowUtc']]) {
    owner[key] = owner[key].replace(/(\.\d{3})Z$/, '$1' + '0000Z');
  }
  assert.equal(validateWgcReceipt(receipt, context).ok, true);
});
reject('UTC with unsupported >7 fractional digits rejected', r => { r.timing.captureBeginUtc = '2026-11-06T01:29:59.00000000Z'; }, 'CAPTURE_BEGIN');
reject('v1 legacy receipt rejected', r => { r.schemaVersion = 1; }, 'RECEIPT_VERSION');
reject('legacy capture property rejected', r => { r.legacyCapture = {}; }, 'LEGACY_RECEIPT');
reject('request mismatch rejected', (r,c) => { c.expectedRequestId = 'different-id'; }, 'REQUEST_MISMATCH');
reject('request replay rejected', (r,c) => { c.requestAlreadyConsumed = true; }, 'REQUEST_REPLAY');
reject('partial receipt rejected', (r,c) => { c.receiptComplete = false; }, 'RECEIPT_PARTIAL');
reject('PID drift rejected', r => { r.target.pid = 12346; }, 'TARGET_MISMATCH_pid');
reject('HWND drift rejected', r => { r.target.hwnd = 991; }, 'TARGET_MISMATCH_hwnd');
reject('session drift rejected', r => { r.target.sessionId = 3; }, 'TARGET_MISMATCH_sessionId');
reject('process start drift rejected', r => { r.target.startedUtc = '2026-11-06T00:03:01Z'; }, 'TARGET_MISMATCH_startedUtc');
reject('process created after capture begins rejected', (r,c) => {
  r.target.startedUtc = '2026-11-06T01:30:00Z';
  c.expectedTarget.startedUtc = r.target.startedUtc;
}, 'TARGET_START_AFTER_CAPTURE');
reject('native class drift rejected', r => { r.target.className = 'Other'; }, 'TARGET_CLASS');
reject('unpinned app rejected', r => { r.source.applicationAssemblySha256 = 'd'.repeat(64); }, 'SOURCE_PIN_applicationAssemblySha256');
reject('missing dependency hash rejected', r => { delete r.source.lockedDependencyManifestSha256; }, 'SOURCE_DEPS_HASH');
reject('fallback provider rejected', r => { r.source.fallbackUsed = true; }, 'SOURCE_FALLBACK');
reject('wrong provider version rejected', r => { r.source.vendorVersion = 'main'; }, 'SOURCE_VERSION');
reject('stale frame > 30 seconds rejected', (r,c) => { c.nowUtc = '2026-11-06T01:31:01Z'; }, 'FRAME_STALE_OR_ORDER');
reject('future frame rejected', (r,c) => { c.nowUtc = '2026-11-06T01:29:00Z'; }, 'FRAME_STALE_OR_ORDER');
reject('frame version 0 rejected', r => { r.timing.frameVersion = 0; }, 'FRAME_VERSION');
reject('monotonic frame not new rejected', r => { r.timing.firstFrameObservedMonotonicTicks = '100000'; }, 'FRAME_NOT_NEW');
reject('zero grabber monotonic tick rejected', r => { r.timing.grabberCreatedMonotonicTicks = '0'; }, 'GRAB_TICK');
reject('negative grabber monotonic tick rejected', r => { r.timing.grabberCreatedMonotonicTicks = '-1'; }, 'GRAB_TICK');
reject('leading-zero grabber tick rejected as noncanonical decimal', r => { r.timing.grabberCreatedMonotonicTicks = '01'; }, 'GRAB_TICK');
reject('signed Int64 max plus one grabber tick rejected', r => { r.timing.grabberCreatedMonotonicTicks = '9223372036854775808'; }, 'GRAB_TICK');
reject('zero first-frame monotonic tick rejected', r => { r.timing.firstFrameObservedMonotonicTicks = '0'; }, 'FRAME_TICK');
reject('signed Int64 max plus one first-frame tick rejected', r => { r.timing.firstFrameObservedMonotonicTicks = '9223372036854775808'; }, 'FRAME_TICK');
reject('first frame timeout rejected', r => { r.timing.maxFirstFrameWaitMs = 200; }, 'FRAME_TIMEOUT');
reject('missing foreground hook rejected', r => { r.foreground.eventHookInstalled = false; }, 'FOREGROUND_HOOK_MISSING');
reject('foreground hook gap rejected', r => { r.foreground.eventHookCoverageComplete = false; }, 'FOREGROUND_HOOK_GAP');
reject('foreground event rejected', r => { r.foreground.foregroundChangeEventCount = 1; }, 'FOREGROUND_EVENTS');
reject('foreground before/after change rejected', r => { r.foreground.afterHwnd = 10; }, 'FOREGROUND_CHANGED');
reject('foreground hook starts too late rejected', r => { r.foreground.hookStartUtc = '2026-11-06T01:29:59.001Z'; }, 'HOOK_INTERVAL_GAP');
reject('foreground hook ends too early rejected', r => { r.foreground.hookStopUtc = '2026-11-06T01:29:59.800Z'; }, 'HOOK_INTERVAL_GAP');
reject('unverified mapping must not be promoted to verified', r => { r.frame.mappingToPhysicalScreen = 'VERIFIED'; }, 'FRAME_MAPPING');
reject('pixel dimensions mismatch rejected', r => { r.frame.width = 3; }, 'PNG_FRAME_WIDTH');
reject('color variation missing rejected', r => { r.frame.colorVariation = false; }, 'FRAME_COLOR_VARIATION');
reject('changed PNG SHA rejected', r => { r.artifact.sha256 = '0'.repeat(64); }, 'ARTIFACT_HASH');
reject('truncated PNG rejected', (r,c) => { c.pngBytes = image.subarray(0, image.length-3); r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes); }, 'PNG_TRUNCATED');
reject('PNG CRC corruption rejected', (r,c) => { c.pngBytes = Buffer.from(image); c.pngBytes[29] ^= 1; r.artifact.sha256 = sha(c.pngBytes); }, 'PNG_CRC');
reject('CRC-valid unknown critical PNG chunk rejected', (r,c) => {
  const deflated = deflateSync(Buffer.from([0, 20, 180, 90, 255, 240, 120, 30, 255]));
  replacePng(r, c, pngWithDataChunks([chunk('FOOO', Buffer.alloc(0)), chunk('IDAT', deflated)]));
}, 'PNG_UNSUPPORTED_CRITICAL_CHUNK');
reject('CRC-valid IDAT chunks separated by ancillary PNG chunk rejected', (r,c) => {
  const deflated = deflateSync(Buffer.from([0, 20, 180, 90, 255, 240, 120, 30, 255]));
  const midpoint = Math.floor(deflated.length / 2);
  replacePng(r, c, pngWithDataChunks([
    chunk('IDAT', deflated.subarray(0, midpoint)),
    chunk('tEXt', Buffer.from('key\0value')),
    chunk('IDAT', deflated.subarray(midpoint))
  ]));
}, 'PNG_ORDER');
reject('CRC-valid but raw IDAT scanline truncated rejected', (r,c) => {
  c.pngBytes = fakePng(Buffer.from([0]));
  r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes);
}, 'PNG_RAW_LENGTH');
reject('CRC-valid raw image invalid PNG filter rejected', (r,c) => {
  c.pngBytes = fakePng(Buffer.from([5, 20, 180, 90, 255, 240, 120, 30, 255]));
  r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes);
}, 'PNG_FILTER');
reject('unsupported PNG bit depth rejected', (r,c) => {
  c.pngBytes = fakePng(undefined, {bitDepth:16});
  r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes);
}, 'PNG_UNSUPPORTED_FORMAT');
reject('unsupported PNG color type rejected', (r,c) => {
  c.pngBytes = fakePng(undefined, {colorType:2});
  r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes);
}, 'PNG_UNSUPPORTED_FORMAT');
reject('interlaced PNG rejected', (r,c) => {
  c.pngBytes = fakePng(undefined, {interlace:1});
  r.artifact.sizeBytes = c.pngBytes.length; r.artifact.sha256 = sha(c.pngBytes);
}, 'PNG_UNSUPPORTED_FORMAT');
reject('incorrect PNG path rejected', r => { r.artifact.relativeEvidencePath = 'C:/temp/a.png'; }, 'ARTIFACT_PATH');
reject('existing non-exclusive output rejected', r => { r.artifact.createExclusive = false; }, 'ARTIFACT_CREATE_EXCLUSIVE');
reject('foregroundMayChange legacy flag rejected', r => { r.operation.foregroundMayChange = true; }, 'OPERATION_foregroundMayChange');
reject('focus attempt rejected', r => { r.operation.focusAttempted = true; }, 'OPERATION_focusAttempted');
reject('input injected rejected', r => { r.operation.inputInjected = true; }, 'OPERATION_inputInjected');
reject('live retry allowed rejected', r => { r.operation.liveRetryAllowed = true; }, 'OPERATION_liveRetryAllowed');
reject('child exit unknown rejected', r => { r.settlement.childExitCode = null; }, 'CHILD_EXIT');
reject('wrapper failed rejected', r => { r.settlement.wrapperExitCode = 1; }, 'WRAPPER_EXIT');
reject('timeout rejected', r => { r.settlement.timeout = true; }, 'SETTLEMENT_TIMEOUT');
reject('post-target mismatch rejected', r => { r.settlement.postTargetIdentityMatches = false; }, 'SETTLEMENT_TARGET');
