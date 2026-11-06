// M2: synthetic watchdog orphan recovery contract. NO real .tools access or GUI input.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const script = path.join(repo, 'scripts', 'Archive-WatchdogOrphanFixture.ps1');
const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const sha = x => createHash('sha256').update(x).digest('hex');
const load = p => JSON.parse(readFileSync(p, 'utf8'));
const fixture = (kind, options = {}) => {
  const root = path.join(os.tmpdir(), 'wb-watchdog-orphan-fixture-' + randomBytes(9).toString('hex'));
  mkdirSync(root);
  assert.match(path.basename(root), /^wb-watchdog-orphan-fixture-[a-f0-9]{12,32}$/);
  const runId = 'orphan' + randomBytes(6).toString('hex');
  const ownerPid = options.ownerPid ?? 2147483000;
  const leaseId = randomUUID();
  const admission = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'workbridge.gui-admission', admissionId: randomUUID(),
    mode: 'producer', producer: 'desktopprobe-watchdog', requestId: runId,
    owner: { pid: ownerPid }, acquiredUtc: new Date().toISOString(),
  }) + '\n');
  const guard = Buffer.from(JSON.stringify({
    schemaVersion: 1, kind: 'workbridge.gui-turn', producer: 'desktopprobe-watchdog',
    runId, requestId: runId, leaseId,
    owner: { pid: ownerPid, processStartUtcTicks: '638000000000000000', sessionId: 1 },
    target: { kind: 'window', pid: null, hwnd: null, process: 'DesktopProbe' },
    acquiredUtc: new Date().toISOString(), synthetic: true,
  }) + '\n');
  const admissionPath = path.join(root, 'desktop-turn-admission.lock');
  const guardPath = path.join(root, 'desktop-input-turn.lock');
  writeFileSync(admissionPath, admission, { flag: 'wx' });
  if (kind === 'dual') writeFileSync(guardPath, guard, { flag: 'wx' });
  return { root, kind, runId, ownerPid, leaseId, admission, guard, admissionPath, guardPath };
};
function invoke(f, { execute = false, admissionHash = sha(f.admission), guardHash = sha(f.guard),
    ownerPid = f.ownerPid, operationId = 'recover_' + randomBytes(6).toString('hex') } = {}) {
  const args = [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
    '-EvidenceRoot', f.root, '-Mode', f.kind,
    '-ExpectedAdmissionSha256', admissionHash,
    '-ExpectedRequestId', f.runId,
    '-ExpectedOwnerPid', String(ownerPid),
    '-OperationId', operationId,
  ];
  if (f.kind === 'dual') args.push('-ExpectedGuardSha256', guardHash, '-ExpectedLeaseId', f.leaseId);
  if (execute) args.push('-Execute');
  return spawnSync(ps, args, {
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 35_000, cwd: repo, maxBuffer: 128 * 1024,
  });
}
function okRun(result, context) {
  assert.equal(result.error ?? null, null, context + ' process error/timeout');
  assert.equal(result.status, 0, context + ' stderr: ' + result.stderr);
  const lines = result.stdout.trim().split(/\r?\n/);
  return JSON.parse(lines.findLast(x => x.startsWith('{')));
}
function denied(result, context) {
  assert.notEqual(result.status, 0, context + ' unexpectedly allowed');
  assert.ok(result.stderr || result.stdout, context + ' must explain rejection');
}
test('synthetic dual orphan: read-only keeps both, Execute archives both by exact ID', { timeout: 80_000 }, () => {
  assert.equal(process.platform, 'win32');
  assert.ok(existsSync(ps) && existsSync(script));
  const f = fixture('dual');
  const preview = okRun(invoke(f), 'dual preview');
  assert.equal(preview.mode, 'read-only');
  assert.equal(preview.liveRecoveryEligible, false);
  assert.equal(preview.archiveCreated, false);
  assert.equal(sha(readFileSync(f.admissionPath)), sha(f.admission));
  assert.equal(sha(readFileSync(f.guardPath)), sha(f.guard));
  const out = okRun(invoke(f, { execute: true }), 'dual Execute');
  assert.equal(out.mode, 'archived');
  assert.equal(out.syntheticOnly, true);
  assert.equal(existsSync(f.admissionPath), false);
  assert.equal(existsSync(f.guardPath), false);
  assert.equal(sha(readFileSync(path.join(out.archive, 'backup', 'desktop-turn-admission.lock'))), sha(f.admission));
  assert.equal(sha(readFileSync(path.join(out.archive, 'relocated', 'desktop-input-turn.lock'))), sha(f.guard));
  assert.equal(load(path.join(out.archive, 'manifest.json')).historicalTreeSettled, 'unverified');
  assert.equal(load(path.join(out.archive, 'completed.json')).newInputPerformed, false);
});
test('synthetic admission-only orphan: preserve until archive final', { timeout: 80_000 }, () => {
  const f = fixture('admission-only');
  assert.equal(okRun(invoke(f), 'admission-only preview').mode, 'read-only');
  const out = okRun(invoke(f, { execute: true }), 'admission-only Execute');
  assert.equal(out.case, 'admission-only');
  assert.equal(existsSync(f.admissionPath), false);
  assert.equal(sha(readFileSync(path.join(out.archive, 'relocated', 'desktop-turn-admission.lock'))), sha(f.admission));
  assert.equal(existsSync(f.guardPath), false);
});
test('wrong admission SHA and unexpected quarantine sidecar fail without moving files', { timeout: 60_000 }, () => {
  const drift = fixture('dual');
  denied(invoke(drift, { execute: true, admissionHash: '0'.repeat(64) }), 'hash drift');
  assert.equal(existsSync(drift.admissionPath), true);
  assert.equal(existsSync(drift.guardPath), true);
  assert.equal(existsSync(path.join(drift.root, 'recovery-archives')), false);
  const extra = fixture('dual');
  writeFileSync(path.join(extra.root, 'desktop-turn-quarantine-extra.json'), '{}\n', { flag: 'wx' });
  denied(invoke(extra, { execute: true }), 'unexpected sidecar');
  assert.equal(existsSync(extra.admissionPath), true);
  assert.equal(existsSync(extra.guardPath), true);
  assert.equal(existsSync(path.join(extra.root, 'recovery-archives')), false);
});
test('PID-reuse/live-owner, admission-only extra guard, and non-fixture path fail closed', { timeout: 80_000 }, () => {
  const alive = fixture('dual', { ownerPid: process.pid });
  denied(invoke(alive, { execute: true }), 'owner pid still live');
  assert.equal(existsSync(alive.admissionPath), true);
  const extraGuard = fixture('admission-only');
  writeFileSync(extraGuard.guardPath, Buffer.from('untrusted\n'), { flag: 'wx' });
  denied(invoke(extraGuard, { execute: true }), 'admission-only unexpected GUI guard');
  assert.equal(existsSync(extraGuard.admissionPath), true);
  const outside = fixture('admission-only');
  const fakeRoot = path.join(outside.root, 'not-a-direct-temp-fixture');
  mkdirSync(fakeRoot);
  const reject = invoke({ ...outside, root: fakeRoot }, { execute: true });
  denied(reject, 'non-fixture path');
  assert.equal(existsSync(outside.admissionPath), true);
});

// Actual watchdog-stamp interoperability: abrupt process exit after native lease
// acquisition, then clone private mock evidence into a distinct OS-temp fixture.
// Never opens a GUI, never reads/writes .tools/desktop-evidence.
for (const kind of ['dual', 'admission-only']) {
  test('published watchdog abrupt exit produces recoverable ' + kind + ' stamp', { timeout: 65_000 }, () => {
    const watchdog = path.join(repo, 'investigations', 'windows-desktop-automation',
      'temp', 'desktopprobe-watchdog-publish', 'DesktopProbeWatchdog.exe');
    assert.equal(existsSync(watchdog), true);
    const runId = 'wdabandon' + randomBytes(6).toString('hex');
    const mode = kind === 'dual' ? '--synthetic-abandon-dual' : '--synthetic-abandon-admission';
    const result = spawnSync(watchdog, [mode, runId], {
      cwd: repo, windowsHide: true, shell: false, timeout: 12_000, encoding: 'utf8',
    });
    assert.equal(result.error ?? null, null, 'abrupt-exit injector timed out');
    assert.equal(result.status, kind === 'dual' ? 71 : 72,
      'expected intentional abrupt exit, got: ' + result.stdout + ' ' + result.stderr);
    const produced = path.join(repo, 'investigations', 'windows-desktop-automation',
      'temp', 'desktopprobe-watchdog-abandon-' + runId);
    const admission = readFileSync(path.join(produced, 'desktop-turn-admission.mock.lock'));
    const guard = kind === 'dual'
      ? readFileSync(path.join(produced, 'desktop-input-turn.mock.lock'))
      : Buffer.from('no-guard');
    const a = JSON.parse(admission.toString('utf8'));
    const g = kind === 'dual' ? JSON.parse(guard.toString('utf8')) : null;
    assert.equal(a.requestId, runId);
    assert.equal(a.producer, 'desktopprobe-watchdog');
    assert.equal(g?.synthetic ?? true, true);
    assert.equal(g?.owner.pid ?? a.owner.pid, a.owner.pid);
    const root = path.join(os.tmpdir(), 'wb-watchdog-orphan-fixture-' + randomBytes(9).toString('hex'));
    mkdirSync(root);
    const f = {
      root, kind, runId, ownerPid: a.owner.pid, leaseId: g?.leaseId, admission, guard,
      admissionPath: path.join(root, 'desktop-turn-admission.lock'),
      guardPath: path.join(root, 'desktop-input-turn.lock'),
    };
    writeFileSync(f.admissionPath, admission, { flag: 'wx' });
    if (g) writeFileSync(f.guardPath, guard, { flag: 'wx' });
    assert.equal(okRun(invoke(f), 'actual-stamp read-only').archiveCreated, false);
    const out = okRun(invoke(f, { execute: true }), 'actual-stamp archival');
    assert.equal(out.syntheticOnly, true);
    assert.equal(existsSync(f.admissionPath), false);
    assert.equal(existsSync(f.guardPath), false);
    assert.equal(sha(readFileSync(path.join(out.archive, 'relocated', 'desktop-turn-admission.lock'))), sha(admission));
    if (g) assert.equal(sha(readFileSync(path.join(out.archive, 'relocated', 'desktop-input-turn.lock'))), sha(guard));
  });
}

// Independent kernel liveness check of a real synthetic child after its Job owner
// exits abruptly. The child otherwise sleeps 30s; we require disappearance
// within 4 seconds, so natural completion cannot masquerade as containment.
test('abrupt watchdog death closes Job and kills sleeping synthetic child', { timeout: 75_000 }, async () => {
  const watchdog = path.join(repo, 'investigations', 'windows-desktop-automation',
    'temp', 'desktopprobe-watchdog-publish', 'DesktopProbeWatchdog.exe');
  assert.equal(existsSync(watchdog), true);
  const runId = 'wdjob' + randomBytes(6).toString('hex');
  const result = spawnSync(watchdog, ['--synthetic-abandon-with-child', runId], {
    cwd: repo, windowsHide: true, shell: false, timeout: 12_000, encoding: 'utf8',
  });
  assert.equal(result.error ?? null, null, 'synthetic watchdog abort timed out');
  assert.equal(result.status, 73, 'unexpected watchdog exit: ' + result.stdout + ' ' + result.stderr);
  const produced = path.join(repo, 'investigations', 'windows-desktop-automation',
    'temp', 'desktopprobe-watchdog-abandon-' + runId);
  const receipt = load(path.join(produced, 'abandon-child-receipt.json'));
  const marker = readFileSync(path.join(produced, 'started-' + runId + '.marker'));
  const admission = readFileSync(path.join(produced, 'desktop-turn-admission.mock.lock'));
  const guard = readFileSync(path.join(produced, 'desktop-input-turn.mock.lock'));
  const a = JSON.parse(admission.toString('utf8'));
  const g = JSON.parse(guard.toString('utf8'));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.activeJobProcessesBeforeAbandon, 2);
  assert.equal(receipt.markerSha256, sha(marker));
  assert.equal(receipt.ownerPid, a.owner.pid);
  assert.equal(receipt.ownerPid, g.owner.pid);
  assert.equal(receipt.childPid > 0 && receipt.childPid !== receipt.ownerPid, true);
  assert.match(receipt.childStartedAtUtcTicks, /^[1-9][0-9]{10,}$/);

  let childAbsent = false;
  for (let i = 0; i < 40; i++) {
    try {
      process.kill(receipt.childPid, 0);
    } catch (err) {
      if (err?.code === 'ESRCH') { childAbsent = true; break; }
      throw err; // EPERM/other uncertainty is not proof of exit.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(childAbsent, true, 'Job kill-on-close failed to settle the synthetic child within 4s');

  // Reuse the existing exact-hash archival contract after independent process
  // disappearance. This still operates on a COPY in a separate OS-temp fixture.
  const root = path.join(os.tmpdir(), 'wb-watchdog-orphan-fixture-' + randomBytes(9).toString('hex'));
  mkdirSync(root);
  const f = {
    root, kind: 'dual', runId, ownerPid: a.owner.pid, leaseId: g.leaseId, admission, guard,
    admissionPath: path.join(root, 'desktop-turn-admission.lock'),
    guardPath: path.join(root, 'desktop-input-turn.lock'),
  };
  writeFileSync(f.admissionPath, admission, { flag: 'wx' });
  writeFileSync(f.guardPath, guard, { flag: 'wx' });
  assert.equal(okRun(invoke(f), 'Job settled read-only preflight').mode, 'read-only');
  const out = okRun(invoke(f, { execute: true }), 'Job settled synthetic archival');
  assert.equal(out.mode, 'archived');
  assert.equal(existsSync(f.admissionPath), false);
  assert.equal(existsSync(f.guardPath), false);
});
