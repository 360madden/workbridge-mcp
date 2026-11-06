// Investigation-only Windows synthetic test: no desktop launch, input, VM, or live lock.
// Prove the actual manual recovery script accepts the watchdog's uncertainty
// sidecar in READ-ONLY mode after cloning exact synthetic evidence to OS temp.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const investigationTemp = path.join(repo, 'investigations', 'windows-desktop-automation', 'temp');
const watchdog = path.join(investigationTemp, 'desktopprobe-watchdog-publish', 'DesktopProbeWatchdog.exe');
const archiveScript = path.join(repo, 'scripts', 'Archive-DesktopQuarantine.ps1');
const pinnedArchiveSha = '5b1860ed41887c408edba9d38eb6b580483db75d5f14e641bf4cf7ccbef8eca0';
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = filename => JSON.parse(readFileSync(filename, 'utf8'));

function runOwned(executable, args, deadlineMs) {
  const result = spawnSync(executable, args, {
    cwd: repo,
    encoding: 'utf8',
    windowsHide: true,
    shell: false,
    timeout: deadlineMs,
    maxBuffer: 256 * 1024,
  });
  assert.equal(result.error?.code ?? null, null, 'owned synthetic child returned process error/timeout');
  assert.equal(result.signal, null, 'owned synthetic child signal/timeout');
  assert.equal(result.status, 0, 'owned synthetic child reported nonzero exit: ' + result.stderr + ' ' + result.stdout);
  return result.stdout;
}

test('watchdog uncertain sidecar parses under real archive read-only preflight', { timeout: 60_000 }, () => {
  assert.equal(process.platform, 'win32', 'Windows fixture only');
  assert.equal(existsSync(watchdog), true, 'explicit published investigation watchdog required');
  assert.equal(existsSync(powershell), true, 'Windows PowerShell 5.1 required');
  assert.equal(hash(readFileSync(archiveScript)), pinnedArchiveSha, 'archive source hash drift; review required');

  // This invokes the watchdog's --synthetic-uncertain mode ONLY. It starts
  // its own synthetic child, kills that child on a <=1.6s private Job deadline,
  // retains mock GUI guard + sidecar, and releases mock admission.
  const runId = 'wdschema' + randomBytes(5).toString('hex');
  runOwned(watchdog, ['--synthetic-uncertain', runId], 15_000);
  const evidence = path.join(investigationTemp, 'desktopprobe-watchdog-smoke-' + runId);
  const rows = readFileSync(path.join(evidence, 'watchdog-' + runId + '.jsonl'), 'utf8')
    .trim().split(/\r?\n/).map(line => JSON.parse(line));
  const final = rows.findLast(row => row.stage === 'final');
  assert.ok(final, 'synthetic watchdog final settlement journal required');
  assert.equal(final.result, 'synthetic_unknown_retained_proven');
  assert.equal(final.operationOutcome, 'unknown_outcome');
  assert.equal(final.settled, true);
  assert.equal(final.childExited, true);
  assert.equal(final.activeAfterSpawn, 2);
  assert.equal(final.activeAfter, 1);
  assert.equal(final.leaseRetained, true);
  assert.equal(final.leaseReleased, false);

  const mockGuardPath = path.join(evidence, 'desktop-input-turn.mock.lock');
  const mockGuardBytes = readFileSync(mockGuardPath);
  const sidecarName = 'desktop-turn-quarantine-' + final.leaseId + '.json';
  const mockSidecarPath = path.join(evidence, sidecarName);
  const mockSidecarBytes = readFileSync(mockSidecarPath);
  const guardStamp = JSON.parse(mockGuardBytes.toString('utf8'));
  const sidecarStamp = JSON.parse(mockSidecarBytes.toString('utf8'));
  assert.equal(guardStamp.requestId, runId);
  assert.equal(sidecarStamp.leaseId, guardStamp.leaseId);
  assert.equal(sidecarStamp.requestId, runId);
  assert.equal(sidecarStamp.reasonCode, 'DESKTOP_TREE_UNSETTLED');
  assert.equal(sidecarStamp.intentSha256, null);
  assert.equal(sidecarStamp.ownerStampSha256, hash(mockGuardBytes));
  assert.equal(sidecarStamp.processTreeSettlement, 'unknown');
  assert.equal(sidecarStamp.automaticRetryAllowed, false);

  // Clone only to a unique OS temp fixture. We NEVER create, read, or rename
  // .tools/desktop-evidence live guard/sidecar files. Preserve temp evidence.
  const fixtureParent = mkdtempSync(path.join(os.tmpdir(), 'wb-archive-fixtures-' + runId + '-'));
  const fixtureRoot = path.join(fixtureParent, 'evidence');
  mkdirSync(fixtureRoot);
  const fixtureGuard = path.join(fixtureRoot, 'desktop-input-turn.lock');
  const fixtureSidecar = path.join(fixtureRoot, sidecarName);
  copyFileSync(mockGuardPath, fixtureGuard);
  copyFileSync(mockSidecarPath, fixtureSidecar);
  assert.equal(hash(readFileSync(fixtureGuard)), hash(mockGuardBytes));
  assert.equal(hash(readFileSync(fixtureSidecar)), hash(mockSidecarBytes));

  const output = runOwned(powershell, [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', archiveScript,
    '-EvidenceRoot', fixtureRoot,
    '-ExpectedLockSha256', hash(mockGuardBytes),
    '-ExpectedSidecarSha256', hash(mockSidecarBytes),
    '-ExpectedLeaseId', final.leaseId,
    '-ExpectedRequestId', runId,
    '-OperationId', 'wd_contract_' + runId,
    // Deliberately NO -Execute. This is strictly read-only classification.
  ], 25_000);
  const preflightLine = output.trim().split(/\r?\n/).findLast(line => line.startsWith('{'));
  assert.ok(preflightLine, 'archive read-only JSON classification required');
  const preflight = JSON.parse(preflightLine);
  assert.equal(preflight.ok, true);
  assert.equal(preflight.mode, 'read-only');
  assert.equal(preflight.readyForManualReview, true);
  assert.equal(preflight.releaseEligible, false);
  assert.equal(preflight.archiveCreated, false);
  assert.equal(preflight.priorActionOutcome, 'unknown_outcome');
  assert.equal(preflight.leaseId, final.leaseId);
  assert.equal(existsSync(path.join(fixtureRoot, 'recovery-archives')), false);
  assert.equal(hash(readFileSync(fixtureGuard)), hash(mockGuardBytes));
  assert.equal(hash(readFileSync(fixtureSidecar)), hash(mockSidecarBytes));
});
