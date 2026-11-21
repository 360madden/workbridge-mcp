import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { readEvidence, ResearchError, SHA256 } from './identity.mjs';

const EXPECTED = ['physical-epoch.json'];
function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPhysicalReceipt(record) {
  const p = record?.selected;
  if (
    record?.schema !== 'workbridge.rift-physical-epoch.v1' ||
    record.status !== 'read_only_identity_observed' ||
    record.liveBindingVerified !== true ||
    record.readOnly !== true ||
    record.inputSent !== false ||
    record.memoryRead !== false ||
    !/^[1-9][0-9]{1,21}$/.test(p?.processStartUtcTicks ?? '') ||
    !Number.isSafeInteger(p?.pid) ||
    p.pid < 1 ||
    !Number.isSafeInteger(p?.window?.hwnd) ||
    p.window.hwnd < 1 ||
    p.window.pid !== p.pid ||
    p.window.className !== 'TWNClientFramework' ||
    p.window.title !== 'RIFT' ||
    typeof p.moduleBaseHex !== 'string' ||
    !/^0x[0-9A-F]+$/.test(p.moduleBaseHex) ||
    !Number.isSafeInteger(p.moduleSizeBytes) ||
    p.moduleSizeBytes <= 0 ||
    typeof p.executableSha256 !== 'string' ||
    !SHA256.test(p.executableSha256) ||
    record.validation?.processEpochRechecked !== true ||
    record.validation?.hwndRechecked !== true ||
    record.validation?.executableHashFromProcessPath !== true ||
    record.validation?.memoryLayoutQualified !== false ||
    record.validation?.sourceTelemetryLinked !== false
  ) {
    throw new ResearchError(
      'PHYSICAL_RECEIPT_INVALID',
      'Physical process receipt does not represent a qualified read-only identity observation.',
    );
  }
}

export async function savePhysicalReceipt(result, outputDir) {
  assertPhysicalReceipt(result);
  if (!outputDir) throw new ResearchError('MISSING_ARGUMENT', 'A new output directory is required.');
  const directory = resolve(outputDir);
  if (existsSync(directory)) {
    throw new ResearchError('OUTPUT_EXISTS', 'Physical epoch directory already exists; refusing overwrite.');
  }
  const bytes = Buffer.from(JSON.stringify(result, null, 2) + '\n', 'utf8');
  const checksum = Buffer.from(digest(bytes) + '  physical-epoch.json\n', 'ascii');
  try {
    await mkdir(directory, { recursive: false });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      throw new ResearchError('OUTPUT_EXISTS', 'Physical epoch directory appeared during publication.');
    }
    throw error;
  }
  await writeFile(join(directory, 'physical-epoch.json'), bytes, { flag: 'wx' });
  // Written last; its presence is the package-completion marker.
  await writeFile(join(directory, 'SHA256SUMS.txt'), checksum, { flag: 'wx' });
  return verifyPhysicalReceipt(directory);
}

export async function verifyPhysicalReceipt(outputDir) {
  if (!outputDir)
    throw new ResearchError('MISSING_ARGUMENT', 'A saved physical epoch directory is required.');
  const directory = resolve(outputDir);
  const [receipt, inventory] = await Promise.all([
    readEvidence(join(directory, 'physical-epoch.json'), 16 * 1024),
    readEvidence(join(directory, 'SHA256SUMS.txt'), 256),
  ]);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(inventory.bytes);
  const expected = digest(receipt.bytes) + '  ' + EXPECTED[0] + '\n';
  if (text !== expected) {
    throw new ResearchError(
      'PHYSICAL_RECEIPT_HASH',
      'Saved physical epoch contents differ from the final checksum inventory.',
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(receipt.bytes));
  } catch {
    throw new ResearchError('PHYSICAL_RECEIPT_INVALID', 'Saved physical epoch is not valid JSON.');
  }
  assertPhysicalReceipt(parsed);
  return {
    verified: true,
    directory,
    recordsVerified: 1,
    pid: parsed.selected.pid,
    processStartUtcTicks: parsed.selected.processStartUtcTicks,
    executableSha256: parsed.selected.executableSha256.toLowerCase(),
    hwnd: parsed.selected.window.hwnd,
    claim: 'archived_read_only_process_identity_at_recording_time',
    currentProcessAliveVerified: false,
    memoryLayoutQualified: false,
    inputAuthorized: false,
  };
}
