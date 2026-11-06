// Offline-only WGC receipt contract validator. No process, GUI, filesystem or capture APIs.
// A passing receipt is evidence-format consistency, NOT proof a physical game was captured.
// Real source, foreground event, target and decoded-pixel witnesses must be independent.
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

const HEX64 = /^[0-9a-f]{64}$/;
const SHA40 = /^[0-9a-f]{40}$/;
const REQUEST = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/;
const PNG_MAGIC = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_FRAME_AGE_MS = 30_000;
const MAX_RAW_BYTES = 96 * 1024 * 1024;
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let i = 0; i < 8; i++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
function parsePng(png) {
  if (!Buffer.isBuffer(png) || png.length < 57 || png.length > MAX_PNG_BYTES) fail('PNG_BYTES_INVALID');
  if (!png.subarray(0, 8).equals(PNG_MAGIC)) fail('PNG_SIGNATURE_IHDR_INVALID');
  let offset = 8;
  let first = true;
  let seenIdat = false;
  let seenIend = false;
  let width = 0;
  let height = 0;
  const idats = [];
  while (offset < png.length) {
    if (offset + 12 > png.length) fail('PNG_TRUNCATED');
    const length = png.readUInt32BE(offset);
    const next = offset + length + 12;
    if (next > png.length) fail('PNG_TRUNCATED');
    const type = png.toString('ascii', offset + 4, offset + 8);
    if (crc32(png.subarray(offset + 4, offset + 8 + length)) !== png.readUInt32BE(offset + 8 + length))
      fail('PNG_CRC');
    if (first) {
      if (type !== 'IHDR' || length !== 13) fail('PNG_SIGNATURE_IHDR_INVALID');
      width = png.readUInt32BE(offset + 8);
      height = png.readUInt32BE(offset + 12);
      if (width < 1 || height < 1 || width > 8192 || height > 8192 ||
          width * height > 8_388_608) fail('PNG_DIMENSIONS_INVALID');
      // This writer's supported output is strictly noninterlaced 8-bit RGBA.
      // Do not accept an undecoded RGB/palette/interlaced format as proof of pixels.
      if (png[offset + 16] !== 8 || png[offset + 17] !== 6 ||
          png[offset + 18] !== 0 || png[offset + 19] !== 0 || png[offset + 20] !== 0)
        fail('PNG_UNSUPPORTED_FORMAT');
      first = false;
    } else if (type === 'IDAT') {
      if (seenIend) fail('PNG_ORDER');
      seenIdat = true;
      idats.push(png.subarray(offset + 8, offset + 8 + length));
    } else if (type === 'IEND') {
      if (length !== 0 || !seenIdat || next !== png.length) fail('PNG_ORDER');
      seenIend = true;
    } else if (type === 'IHDR') fail('PNG_ORDER');
    offset = next;
  }
  if (!seenIdat || !seenIend) fail('PNG_TRUNCATED');
  let raw;
  try { raw = inflateSync(Buffer.concat(idats), { maxOutputLength: MAX_RAW_BYTES }); }
  catch { fail('PNG_COMPRESSED_DATA'); }
  const stride = width * 4 + 1;
  if (raw.length !== stride * height) fail('PNG_RAW_LENGTH');
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] > 4) fail('PNG_FILTER');
  }
  return { width, height };
}

function fail(code) { throw Object.assign(new Error(code), { code }); }
function requireTrue(value, code) { if (value !== true) fail(code); }
function requireFalse(value, code) { if (value !== false) fail(code); }
function record(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}
function positiveInt(value, code) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(code);
  return value;
}
function naturalInt(value, code) {
  if (!Number.isSafeInteger(value) || value < 0) fail(code);
  return value;
}
function sha256(value, code) { if (typeof value !== 'string' || !HEX64.test(value)) fail(code); }
function utc(value, code) {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(value)) fail(code);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 19) !== value.slice(0, 19)) fail(code);
  return ms;
}
function tick(value, code) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) fail(code);
  return BigInt(value);
}
function same(value, expected, code) { if (value !== expected) fail(code); }

// Validates the in-memory envelope and captured bytes. Never reads the target or disk.
export function validateWgcReceipt(receipt, context) {
  const r = record(receipt, 'RECEIPT_OBJECT_REQUIRED');
  const c = record(context, 'CONTEXT_REQUIRED');
  const expected = record(c.expectedTarget, 'EXPECTED_TARGET_REQUIRED');
  const png = c.pngBytes;
  const { width: pw, height: ph } = parsePng(png);

  same(r.kind, 'workbridge.physical-rift-wgc-capture-receipt', 'RECEIPT_KIND');
  same(r.schemaVersion, 2, 'RECEIPT_VERSION');
  if (typeof r.uniqueRequestId !== 'string' || !REQUEST.test(r.uniqueRequestId)) fail('REQUEST_ID');
  same(r.uniqueRequestId, c.expectedRequestId, 'REQUEST_MISMATCH');
  requireFalse(c.requestAlreadyConsumed, 'REQUEST_REPLAY');
  requireTrue(c.receiptComplete, 'RECEIPT_PARTIAL');
  if (Object.hasOwn(r, 'legacyCapture') || Object.hasOwn(r, 'captureCommand')) fail('LEGACY_RECEIPT');
  const target = record(r.target, 'TARGET_REQUIRED');
  for (const key of ['pid', 'hwnd', 'sessionId']) positiveInt(target[key], 'TARGET_' + key);
  naturalInt(target.ownerHwnd, 'TARGET_OWNER');
  same(target.ownerHwnd, 0, 'TARGET_OWNER');
  same(target.process, 'rift_x64', 'TARGET_PROCESS');
  same(target.title, 'RIFT', 'TARGET_TITLE');
  same(target.className, 'TWNClientFramework', 'TARGET_CLASS');
  const targetStart = utc(target.startedUtc, 'TARGET_START_TIME');
  for (const key of ['pid', 'hwnd', 'sessionId', 'ownerHwnd', 'process', 'title', 'className', 'startedUtc']) {
    same(target[key], expected[key], 'TARGET_MISMATCH_' + key);
  }

  const source = record(r.source, 'SOURCE_REQUIRED');
  same(source.vendorPackage, 'Microsoft.Windows.SDK.BuildTools.WinApp.UIAutomation', 'SOURCE_VENDOR');
  same(source.vendorVersion, '0.7.1', 'SOURCE_VERSION');
  same(source.backendVerified, 'WGC-only', 'SOURCE_BACKEND');
  requireFalse(source.fallbackUsed, 'SOURCE_FALLBACK');
  sha256(source.applicationAssemblySha256, 'SOURCE_APP_HASH');
  sha256(source.lockedDependencyManifestSha256, 'SOURCE_DEPS_HASH');
  if (typeof source.sourceCommit !== 'string' || !SHA40.test(source.sourceCommit)) fail('SOURCE_COMMIT');
  if (c.expectedSource) {
    const pin = record(c.expectedSource, 'EXPECTED_SOURCE_REQUIRED');
    for (const key of ['applicationAssemblySha256', 'lockedDependencyManifestSha256', 'sourceCommit']) {
      same(source[key], pin[key], 'SOURCE_PIN_' + key);
    }
  } else fail('EXPECTED_SOURCE_REQUIRED');

  const timing = record(r.timing, 'TIMING_REQUIRED');
  const begin = utc(timing.captureBeginUtc, 'CAPTURE_BEGIN');
  if (targetStart > begin) fail('TARGET_START_AFTER_CAPTURE');
  const frameUtc = utc(timing.firstFrameObservedUtc, 'FRAME_TIME');
  const end = utc(timing.captureEndUtc, 'CAPTURE_END');
  const now = utc(c.nowUtc, 'NOW_TIME');
  if (begin > frameUtc || frameUtc > end || end > now || now - end > MAX_FRAME_AGE_MS) fail('FRAME_STALE_OR_ORDER');
  const grabTick = tick(timing.grabberCreatedMonotonicTicks, 'GRAB_TICK');
  const frameTick = tick(timing.firstFrameObservedMonotonicTicks, 'FRAME_TICK');
  if (frameTick <= grabTick) fail('FRAME_NOT_NEW');
  if (positiveInt(timing.maxFirstFrameWaitMs, 'FRAME_WAIT_LIMIT') > 7000 ||
      frameUtc - begin > timing.maxFirstFrameWaitMs) fail('FRAME_TIMEOUT');
  positiveInt(timing.frameVersion, 'FRAME_VERSION');
  const foreground = record(r.foreground, 'FOREGROUND_REQUIRED');
  positiveInt(foreground.beforeHwnd, 'FOREGROUND_BASE');
  same(foreground.afterHwnd, foreground.beforeHwnd, 'FOREGROUND_CHANGED');
  requireTrue(foreground.eventHookInstalled, 'FOREGROUND_HOOK_MISSING');
  requireTrue(foreground.eventHookCoverageComplete, 'FOREGROUND_HOOK_GAP');
  same(foreground.foregroundChangeEventCount, 0, 'FOREGROUND_EVENTS');
  same(foreground.proofScope, 'instrumented-interval', 'FOREGROUND_PROOF');
  requireTrue(foreground.observedUnchanged, 'FOREGROUND_UNCHANGED');
  if (utc(foreground.hookStartUtc, 'HOOK_START') > begin ||
      utc(foreground.hookStopUtc, 'HOOK_END') < end) fail('HOOK_INTERVAL_GAP');

  const frame = record(r.frame, 'FRAME_REQUIRED');
  same(positiveInt(frame.width, 'FRAME_WIDTH'), pw, 'PNG_FRAME_WIDTH');
  same(positiveInt(frame.height, 'FRAME_HEIGHT'), ph, 'PNG_FRAME_HEIGHT');
  requireTrue(frame.colorVariation, 'FRAME_COLOR_VARIATION');
  same(frame.frameSource, 'new-frame-from-new-grabber', 'FRAME_SOURCE');
  same(frame.mappingToPhysicalScreen, 'UNVERIFIED_UNTIL_SYNTHETIC_CALIBRATION', 'FRAME_MAPPING');

  const artifact = record(r.artifact, 'ARTIFACT_REQUIRED');
  same(artifact.relativeEvidencePath, '.tools/desktop-evidence/capture-wgc-' + r.uniqueRequestId + '.png', 'ARTIFACT_PATH');
  same(artifact.receiptPath, '.tools/desktop-evidence/capture-wgc-' + r.uniqueRequestId + '.json', 'RECEIPT_PATH');
  requireTrue(artifact.createExclusive, 'ARTIFACT_CREATE_EXCLUSIVE');
  requireTrue(artifact.immutableReceipt, 'ARTIFACT_IMMUTABLE');
  requireTrue(artifact.pngHeaderVerified, 'ARTIFACT_PNG_HEADER');
  requireTrue(artifact.decodedDimensionsVerified, 'ARTIFACT_DECODED_DIMENSIONS');
  same(artifact.sizeBytes, png.length, 'ARTIFACT_SIZE');
  sha256(artifact.sha256, 'ARTIFACT_SHA_FORMAT');
  same(artifact.sha256, createHash('sha256').update(png).digest('hex'), 'ARTIFACT_HASH');

  const operation = record(r.operation, 'OPERATION_REQUIRED');
  requireTrue(operation.readOnly, 'OPERATION_READ_ONLY');
  for (const key of ['inputInjected', 'focusAttempted', 'windowRestored', 'windowActivated',
                     'foregroundMayChange', 'liveRetryAllowed']) requireFalse(operation[key], 'OPERATION_' + key);
  const settlement = record(r.settlement, 'SETTLEMENT_REQUIRED');
  same(settlement.wrapperExitCode, 0, 'WRAPPER_EXIT');
  same(settlement.childExitCode, 0, 'CHILD_EXIT');
  requireFalse(settlement.timeout, 'SETTLEMENT_TIMEOUT');
  requireFalse(settlement.unknownOutcome, 'SETTLEMENT_UNKNOWN');
  requireTrue(settlement.postTargetIdentityMatches, 'SETTLEMENT_TARGET');
  requireTrue(settlement.receiptPngRehashMatches, 'SETTLEMENT_REHASH');

  // This module does not verify actual captured pixels, WinEventHook coverage,
  // Windows target identity or launcher exit. Those remain independently observed.
  return Object.freeze({ ok: true, readOnly: true, liveRetryAllowed: false,
    requestId: r.uniqueRequestId, frameAgeMs: now - end,
    pngSha256: artifact.sha256, pngWidth: pw, pngHeight: ph,
    pngValidationScope: 'STRUCTURAL_CRC_INFLATE_ONLY', independentPixelDecodeVerified: false,
    scope: 'OFFLINE_RECEIPT_CONSISTENCY_ONLY' });
}
