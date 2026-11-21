import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectOfflineClient, readEvidence, ResearchError, SHA256 } from './identity.mjs';
import { DEFAULT_PYTHON } from './bundle.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const DEFAULT_RRE_ANALYZER = join(ROOT, 'rre', 'tools', 'rift_update_analyzer.py');
const MAX_REPORT_BYTES = 12 * 1024 * 1024;
const BASE_FILES = ['report.json', 'report.md', 'analyzer-source.py', 'patch-manifest.json'];
const OPTIONAL_ANCHORS = 'anchors.source';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function runComparator({
  python,
  analyzerPath,
  beforeFile,
  afterFile,
  outputDir,
  expectedBeforeSha256,
  anchorsFile,
  timeoutMs = 120_000,
}) {
  const args = [
    '-B',
    analyzerPath,
    '--before',
    beforeFile,
    '--after',
    afterFile,
    '--output-dir',
    outputDir,
    '--expected-before-sha',
    expectedBeforeSha256,
  ];
  if (anchorsFile) args.push('--anchors', anchorsFile);
  const child = spawn(python, args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  let overflow = false;
  let timedOut = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    if (stdout.length > 32_768) {
      overflow = true;
      child.kill();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
    if (stderr.length > 16_384) {
      overflow = true;
      child.kill();
    }
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  timer.unref();
  let exitCode;
  try {
    exitCode = await new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (code) => resolveExit(code));
    });
  } catch (error) {
    throw new ResearchError('PATCH_ANALYZER_LAUNCH', 'RRE analyzer launch failed: ' + error.message);
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw new ResearchError('PATCH_ANALYZER_TIMEOUT', 'RRE comparator exceeded the deadline.');
  if (overflow)
    throw new ResearchError('PATCH_ANALYZER_OUTPUT_LIMIT', 'RRE comparator output exceeded limits.');
  if (![0, 2].includes(exitCode)) {
    throw new ResearchError(
      'PATCH_ANALYZER_FAILED',
      'RRE comparator exit ' + exitCode + ': ' + stderr.slice(0, 1200),
    );
  }
  let summary;
  try {
    summary = JSON.parse(stdout.trim());
  } catch {
    throw new ResearchError('PATCH_ANALYZER_RESPONSE', 'RRE comparator emitted invalid JSON summary.');
  }
  if ((exitCode === 2 && summary.status !== 'CHANGED') || (exitCode === 0 && summary.status !== 'MATCH')) {
    throw new ResearchError('PATCH_ANALYZER_RESPONSE', 'RRE exit code and summary status disagree.');
  }
  return { exitCode, summary };
}

async function sameSource(initial, maxBytes) {
  const reread = await readEvidence(initial.path, maxBytes);
  if (reread.sha256 !== initial.sha256 || reread.size !== initial.size) {
    throw new ResearchError('PATCH_SOURCE_CHANGED', 'Analysis input changed while working: ' + initial.path);
  }
}

export async function comparePatch({
  beforeFile,
  afterFile,
  outputDir,
  expectedHost,
  expectedBeforeSha256,
  expectedAfterSha256 = null,
  python = DEFAULT_PYTHON,
  analyzerFile = DEFAULT_RRE_ANALYZER,
  anchorsFile = null,
  host = hostname(),
}) {
  if (
    !beforeFile ||
    !afterFile ||
    !outputDir ||
    !expectedHost ||
    typeof expectedBeforeSha256 !== 'string' ||
    !SHA256.test(expectedBeforeSha256)
  ) {
    throw new ResearchError(
      'PATCH_ARGUMENTS',
      'Supply two different PE images, new output directory, expected host and full pinned baseline SHA.',
    );
  }
  if (expectedAfterSha256 !== null && !SHA256.test(expectedAfterSha256)) {
    throw new ResearchError('PATCH_ARGUMENTS', 'Expected post-update SHA must be 64 hexadecimal characters.');
  }
  const out = resolve(outputDir);
  if (existsSync(out)) throw new ResearchError('OUTPUT_EXISTS', 'Patch report directory already exists.');
  if (resolve(beforeFile).toLowerCase() === resolve(afterFile).toLowerCase()) {
    throw new ResearchError('PATCH_ARGUMENTS', 'Before and after images must be distinct archived files.');
  }
  const [before, after, analyzer, anchors] = await Promise.all([
    inspectOfflineClient(beforeFile, expectedHost, expectedBeforeSha256, host),
    inspectOfflineClient(afterFile, expectedHost, expectedAfterSha256, host),
    readEvidence(analyzerFile, 128 * 1024),
    anchorsFile ? readEvidence(anchorsFile, 128 * 1024) : Promise.resolve(null),
  ]);
  if (
    analyzer.path.toLowerCase() === out.toLowerCase() ||
    before.path.toLowerCase() === after.path.toLowerCase()
  ) {
    throw new ResearchError('PATCH_ARGUMENTS', 'Patch inputs cannot overlap output or one another.');
  }
  const executed = await runComparator({
    python,
    analyzerPath: analyzer.path,
    beforeFile: before.path,
    afterFile: after.path,
    outputDir: out,
    expectedBeforeSha256: before.sha256,
    anchorsFile: anchors?.path ?? null,
  });
  const [reportFile, markdownFile] = await Promise.all([
    readEvidence(join(out, 'report.json'), MAX_REPORT_BYTES),
    readEvidence(join(out, 'report.md'), 1024 * 1024),
  ]);
  let report;
  try {
    report = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(reportFile.bytes));
  } catch {
    throw new ResearchError('PATCH_REPORT', 'RRE report is not valid JSON.');
  }
  if (
    report.schemaVersion !== 1 ||
    !['CHANGED', 'MATCH'].includes(report.status) ||
    report.status !== executed.summary.status ||
    report.nativeOffsetsQualified !== false ||
    report.requiresRuntimeRequalification !== true ||
    report.before?.sha256 !== before.sha256 ||
    report.after?.sha256 !== after.sha256 ||
    executed.summary.oldSha256 !== before.sha256 ||
    executed.summary.newSha256 !== after.sha256 ||
    !Array.isArray(report.sections) ||
    !Array.isArray(report.anchors)
  ) {
    throw new ResearchError('PATCH_REPORT', 'RRE report contradicts pinned inputs or expected static scope.');
  }
  await Promise.all([
    sameSource(analyzer, 128 * 1024),
    ...(anchors ? [sameSource(anchors, 128 * 1024)] : []),
  ]);
  await Promise.all([
    inspectOfflineClient(before.path, expectedHost, before.sha256, host),
    inspectOfflineClient(after.path, expectedHost, after.sha256, host),
  ]);

  const artifacts = [...BASE_FILES, ...(anchors ? [OPTIONAL_ANCHORS] : [])];
  const manifest = {
    schema: 'workbridge.rift-patch-evidence.v1',
    completedUtc: new Date().toISOString(),
    mode: 'offline_static_pe_comparison',
    machine: { expected: String(expectedHost).toUpperCase(), observed: String(host).toUpperCase() },
    before,
    after,
    analyzer: { originalPath: analyzer.path, sha256: analyzer.sha256, bytes: analyzer.size },
    anchors: anchors ? { originalPath: anchors.path, sha256: anchors.sha256, bytes: anchors.size } : null,
    reportStatus: report.status,
    changedSections: report.sections.filter((item) => item.status !== 'identical').length,
    anchorCount: report.anchors.length,
    nativeOffsetsQualified: false,
    requiresRuntimeRequalification: true,
    noLiveProcessContact: true,
    artifacts,
  };
  const writes = [
    ['analyzer-source.py', analyzer.bytes],
    ...(anchors ? [[OPTIONAL_ANCHORS, anchors.bytes]] : []),
    ['patch-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')],
  ];
  for (const [name, bytes] of writes) await writeFile(join(out, name), bytes, { flag: 'wx' });
  const contentHashes = {
    'report.json': reportFile.sha256,
    'report.md': markdownFile.sha256,
    'analyzer-source.py': analyzer.sha256,
    ...(anchors ? { [OPTIONAL_ANCHORS]: anchors.sha256 } : {}),
    'patch-manifest.json': digest(writes.at(-1)[1]),
  };
  const inventory = artifacts.map((name) => contentHashes[name] + '  ' + name).join('\n') + '\n';
  await writeFile(join(out, 'SHA256SUMS.txt'), inventory, { flag: 'wx' });
  return {
    status: 'completed_offline_patch_comparison',
    directory: out,
    result: report.status,
    beforeSha256: before.sha256,
    afterSha256: after.sha256,
    changedSections: manifest.changedSections,
    anchorsChecked: report.anchors.length,
    nativeOffsetsQualified: false,
    artifactVerification: await verifyPatch(out),
  };
}

export async function verifyPatch(outputDir) {
  const dir = resolve(outputDir);
  const manifestFile = await readEvidence(join(dir, 'patch-manifest.json'), 128 * 1024);
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(manifestFile.bytes));
  } catch {
    throw new ResearchError('PATCH_BUNDLE_MANIFEST', 'Invalid patch manifest JSON.');
  }
  if (
    manifest?.schema !== 'workbridge.rift-patch-evidence.v1' ||
    !['CHANGED', 'MATCH'].includes(manifest.reportStatus) ||
    manifest.nativeOffsetsQualified !== false ||
    manifest.requiresRuntimeRequalification !== true ||
    manifest.noLiveProcessContact !== true ||
    !SHA256.test(manifest.before?.sha256) ||
    !SHA256.test(manifest.after?.sha256)
  ) {
    throw new ResearchError('PATCH_BUNDLE_MANIFEST', 'Unsupported patch manifest or qualification claims.');
  }
  const names = [...BASE_FILES, ...(manifest.anchors ? [OPTIONAL_ANCHORS] : [])];
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(names)) {
    throw new ResearchError('PATCH_BUNDLE_MANIFEST', 'Patch artifact inventory is inconsistent.');
  }
  const sums = await readEvidence(join(dir, 'SHA256SUMS.txt'), 4096);
  const lines = new TextDecoder('utf8', { fatal: true }).decode(sums.bytes).trim().split(/\r?\n/);
  if (lines.length !== names.length) {
    throw new ResearchError('PATCH_BUNDLE_INCOMPLETE', 'Patch checksum list is incomplete.');
  }
  const entries = new Map();
  for (const line of lines) {
    const match = /^([0-9a-f]{64})  ([a-zA-Z0-9.-]+)$/.exec(line);
    if (!match || !names.includes(match[2]) || entries.has(match[2])) {
      throw new ResearchError('PATCH_BUNDLE_INVENTORY', 'Invalid patch checksum list.');
    }
    entries.set(match[2], match[1]);
  }
  const verified = await Promise.all(
    names.map((name) =>
      readEvidence(join(dir, name), name === 'report.json' ? MAX_REPORT_BYTES : 1024 * 1024),
    ),
  );
  for (let i = 0; i < names.length; i++) {
    if (entries.get(names[i]) !== verified[i].sha256) {
      throw new ResearchError('PATCH_BUNDLE_HASH', 'Patch artifact content mismatch: ' + names[i]);
    }
  }
  let report;
  try {
    report = JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(verified[0].bytes));
  } catch {
    throw new ResearchError('PATCH_BUNDLE_REPORT', 'Patch report is invalid JSON.');
  }
  if (
    report.schemaVersion !== 1 ||
    report.status !== manifest.reportStatus ||
    report.before?.sha256 !== manifest.before.sha256 ||
    report.after?.sha256 !== manifest.after.sha256 ||
    report.nativeOffsetsQualified !== false ||
    report.requiresRuntimeRequalification !== true ||
    !Array.isArray(report.sections) ||
    !Array.isArray(report.anchors) ||
    manifest.changedSections !== report.sections.filter((section) => section.status !== 'identical').length ||
    manifest.anchorCount !== report.anchors.length ||
    manifest.analyzer?.sha256 !== verified[2].sha256 ||
    (manifest.anchors !== null && manifest.anchors?.sha256 !== verified.at(-1).sha256)
  ) {
    throw new ResearchError('PATCH_BUNDLE_REPORT', 'Static report contradicts saved patch manifest.');
  }
  return {
    verified: true,
    filesVerified: names.length,
    directory: dir,
    status: manifest.reportStatus,
    caveat: 'Byte-level patch evidence only; no moved function, pointer chain or live runtime qualified.',
  };
}
