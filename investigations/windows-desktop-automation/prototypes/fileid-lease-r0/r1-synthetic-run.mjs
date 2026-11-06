#!/usr/bin/env node
// R1 INVESTIGATION-ONLY. GUID OS-temp fixtures; no production lock path.
// Requires a reviewed R1 native helper compiled separately from pinned R0 binary.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { link, mkdir, readFile, realpath, rename, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

const exe = process.argv[2];
const expectedExeSha = String(process.argv[3] || '').toLowerCase();
const benchmark = process.argv.length === 5 && process.argv[4] === '--benchmark';
if (process.platform !== 'win32' || !exe || !path.isAbsolute(exe) ||
    !exe.toLowerCase().endsWith('.exe') || !existsSync(exe) ||
    !/^[0-9a-f]{64}$/.test(expectedExeSha) ||
    (process.argv.length !== 4 && !benchmark)) {
  throw new Error('An absolute R1 .exe AND its exact SHA256 are required; optional --benchmark');
}
const exeSha = createHash('sha256').update(await readFile(exe)).digest('hex');
if (exeSha !== expectedExeSha) throw new Error('R1_EXE_SHA_CHANGED');
const temp = path.resolve(os.tmpdir()).replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase();
const tempName = temp + '\\';
const local = String(process.env.LOCALAPPDATA || '').replaceAll('/', '\\').toLowerCase();
if (!local || !tempName.startsWith(local + '\\') ||
    path.basename(temp).toLowerCase() !== 'temp' ||
    tempName.startsWith('c:\\work\\') || tempName.includes('\\workbridge-mcp\\') ||
    tempName.includes('\\.tools\\') || tempName.includes('\\.local\\') ||
    tempName.includes('\\rift\\') || tempName.includes('\\rift modding\\') ||
    tempName.includes('\\vms\\') || tempName.includes('\\onedrive\\') ||
    (await realpath(os.tmpdir())).replaceAll('/', '\\').toLowerCase() !== temp) {
  throw new Error('R1_TEMP_PREFLIGHT_FAILED');
}
const expectedTempHash = createHash('sha256').update(Buffer.from(temp, 'utf8')).digest('hex');
const id = () => randomUUID().replaceAll('-', '');
const root = (value) => path.join(os.tmpdir(), 'workbridge-fileid-r0-' + value);
const leaf = (value) => path.join(root(value), 'synthetic-fileid-lease.lock');
const argsFor = (value) => ['--fixture-id', value];
const releaseArgs = (token, extra = []) => [
  'release', ...argsFor(token.fixtureId),
  '--volume', token.volume, '--file-id', token.fileId,
  '--sha256', token.sha256, '--lease-id', token.leaseId, ...extra
];
const parseOne = (out) => {
  const lines = out.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, 'exact one-line helper result when no barrier');
  return JSON.parse(lines[0]);
};
const invoke = (args, expectedExit = 0) => {
  const r = spawnSync(exe, args, {
    windowsHide: true, shell: false, encoding: 'utf8', timeout: 8000, maxBuffer: 65536
  });
  assert.equal(r.error, undefined, 'owned native child terminated within 8 seconds');
  assert.equal(r.status, expectedExit, 'unexpected native status or refusal');
  assert.equal(r.signal, null);
  const result = parseOne(r.stdout);
  if (expectedExit === 0) assert.equal(result.ok, true);
  else assert.equal(result.ok, false);
  return result;
};
const create = () => {
  const value = id();
  const result = invoke(['create', ...argsFor(value)]);
  assert.equal(result.fixtureId, value);
  assert.equal(result.tempRootSha256, expectedTempHash, 'native/Node canonical temp diverged');
  return result;
};

// One owned child at a time; readiness MUST settle on close/error/timeout.
// This is not a blanket Job Object descendant-settlement guarantee.
const readyChild = (command, args, readyText, timeoutMs = 5500) => {
  const child = spawn(command, args, {
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe']
  });
  let out = '', err = '', ready = false, readyDone = false, readyResolve, readyReject;
  const readyPromise = new Promise((resolve, reject) => {
    readyResolve = resolve; readyReject = reject;
  });
  const rejectReady = (error) => {
    if (!readyDone) { readyDone = true; readyReject(error); }
  };
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const timeout = new Error('OWNED_CHILD_DEADLINE');
      rejectReady(timeout);
      child.kill(); // exact owned disposable child only
      reject(timeout);
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      out += chunk.toString('utf8');
      if (out.length > 65536) {
        const error = new Error('OWNED_CHILD_STDOUT_BOUNDS');
        rejectReady(error); child.kill(); reject(error);
        return;
      }
      if (!ready && out.includes(readyText)) {
        ready = true; readyDone = true; readyResolve();
      }
    });
    child.stderr.on('data', (chunk) => {
      err += chunk.toString('utf8');
      if (err.length > 8192) {
        const error = new Error('OWNED_CHILD_STDERR_BOUNDS');
        rejectReady(error); child.kill(); reject(error);
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer); rejectReady(error); reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (!ready) rejectReady(new Error('OWNED_CHILD_NEVER_READY'));
      resolve({ code, signal, out, err });
    });
  });
  // If readiness fails before caller awaits completion, avoid unhandled rejection.
  void done.catch(() => {});
  const acknowledge = () => new Promise((resolve, reject) => {
    if (!ready || child.killed || child.stdin.destroyed) {
      reject(new Error('ACK_NOT_ALLOWED_WITHOUT_LIVE_PINNED_CHILD'));
      return;
    }
    child.stdin.write('ACK\n', (error) => {
      if (error) { reject(error); return; }
      child.stdin.end();
      resolve();
    });
  });
  return { ready: readyPromise, done, acknowledge };
};

const outcomes = [], skipped = [];
try {
  // H01: a second hardlink to the exact same FileId must block release.
  {
    const lease = create();
    await link(leaf(lease.fixtureId), leaf(lease.fixtureId) + '.hardlink');
    const original = await readFile(leaf(lease.fixtureId));
    assert.equal(invoke(releaseArgs(lease), 3).code, 'SOURCE_UNSAFE');
    assert.deepEqual(await readFile(leaf(lease.fixtureId)), original);
    assert.deepEqual(await readFile(leaf(lease.fixtureId) + '.hardlink'), original);
    outcomes.push({ case: 'hardlink_count_two_refused', result: 'PASS', fixtureId: lease.fixtureId });
  }

  // S01: an unrelated read-share-only handle refuses native DELETE-open.
  {
    const lease = create();
    const winRoot = String(process.env.SystemRoot || 'C:\\Windows');
    const ps = path.join(winRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    assert.equal(existsSync(ps), true);
    const code = [
      "$ErrorActionPreference='Stop'",
      "$f=[IO.Path]::Combine([IO.Path]::GetFullPath([IO.Path]::GetTempPath()),'workbridge-fileid-r0-" +
        lease.fixtureId + "','synthetic-fileid-lease.lock')",
      "$h=[IO.File]::Open($f,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)",
      "try{[Console]::Out.WriteLine('SHARE_READY'); [Console]::Out.Flush();",
      "[Threading.Thread]::Sleep(1500)}finally{$h.Dispose()}"
    ].join(';');
    const holder = readyChild(ps, ['-NoProfile', '-NonInteractive', '-Command', code], 'SHARE_READY');
    await holder.ready;
    const blocked = invoke(releaseArgs(lease), 3);
    assert.equal(blocked.code, 'SOURCE_OPEN_REFUSED');
    assert.equal(existsSync(leaf(lease.fixtureId)), true);
    const settled = await holder.done;
    assert.equal(settled.code, 0);
    assert.equal(settled.signal, null);
    const released = invoke(releaseArgs(lease));
    assert.equal(released.releasedOriginalId, lease.fileId);
    outcomes.push({ case: 'share_read_denies_delete_until_holder_exits', result: 'PASS', fixtureId: lease.fixtureId });
  }

  // B01: after an identity-verified open DELETE handle signals PINNED,
  // another process must not rename away or replace its canonical name.
  {
    const lease = create();
    const handle = readyChild(exe, releaseArgs(lease, ['--test-barrier-timeout-ms', '1500']), '"stage":"pinned"');
    await handle.ready;
    let blockedCode = null, renameSucceeded = false;
    try {
      await rename(leaf(lease.fixtureId), leaf(lease.fixtureId) + '.renamed-during-pin');
      renameSucceeded = true;
    } catch (e) {
      blockedCode = String(e?.code ?? 'UNKNOWN');
    }
    // ACK is sent only AFTER the competing rename attempt has returned.
    // Native must retain its original DELETE handle until this exact ACK.
    const ackStart = performance.now();
    await handle.acknowledge();
    const ackDone = performance.now();
    assert.ok(ackDone >= ackStart);
    const settled = await handle.done;
    assert.equal(settled.code, 0, 'native release should settle if rename denied');
    assert.equal(settled.signal, null);
    const lines = settled.out.trim().split(/\r?\n/).map((x) => JSON.parse(x));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].stage, 'pinned');
    assert.equal(lines[1].ok, true);
    assert.equal(renameSucceeded, false, 'RENAME_SUCCEEDED_WHILE_DELETE_HANDLE_PINNED');
    assert.ok(['EACCES', 'EPERM', 'EBUSY'].includes(blockedCode),
      'unexpected in-flight rename refusal code: ' + blockedCode);
    assert.equal(existsSync(leaf(lease.fixtureId)), false);
    assert.equal(existsSync(leaf(lease.fixtureId) + '.renamed-during-pin'), false);
    outcomes.push({ case: 'rename_race_during_held_delete_handle_refused',
      result: 'PASS', fixtureId: lease.fixtureId, refusalCode: blockedCode });
  }

  // B02: a missing ACK must NEVER automatically release a verified original.
  {
    const lease = create();
    const handle = readyChild(exe,
      releaseArgs(lease, ['--test-barrier-timeout-ms', '500']), '"stage":"pinned"');
    await handle.ready;
    // Intentionally do not acknowledge. The native timeout is a retained-lock refusal.
    const settled = await handle.done;
    assert.equal(settled.code, 4);
    assert.equal(settled.signal, null);
    const lines = settled.out.trim().split(/\r?\n/).map((x) => JSON.parse(x));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].stage, 'pinned');
    assert.equal(lines[1].ok, false, 'native missing ACK must refuse disposition');
    assert.equal(lines[1].code, 'BARRIER_TIMEOUT_RETAINED');
    assert.equal(existsSync(leaf(lease.fixtureId)), true, 'original must still exist');
    const retainedBytes = await readFile(leaf(lease.fixtureId));
    assert.equal(createHash('sha256').update(retainedBytes).digest('hex'), lease.sha256,
      'native timeout must retain the identical original stamp bytes');
    outcomes.push({ case: 'missing_ack_retains_lock', result: 'PASS', fixtureId: lease.fixtureId });
  }

  // R01: directory reparse-point/junction test if Windows allows its creation.
  // Do not make missing symlink privilege count as an unearned green.
  {
    const lease = create();
    const alias = id();
    const aliasRoot = root(alias);
    try {
      await symlink(root(lease.fixtureId), aliasRoot, 'junction');
    } catch (error) {
      if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error?.code)) {
        skipped.push({ case: 'directory_junction_guard', reason: 'WINDOWS_JUNCTION_PRIVILEGE_UNAVAILABLE' });
      } else throw error;
    }
    if (existsSync(aliasRoot)) {
      const rejected = invoke(['create', ...argsFor(alias), '--existing-root'], 4);
      assert.equal(rejected.code, 'UNSAFE_DIRECTORY_COMPONENT');
      assert.equal(existsSync(leaf(lease.fixtureId)), true);
      outcomes.push({ case: 'directory_junction_guard', result: 'PASS',
        originalFixtureId: lease.fixtureId, aliasFixtureId: alias });
    }
  }

  // P01 optional 10+30 cached-launch timing; not a claim of true OS cold boot.
  if (benchmark) {
    const measurements = [];
    for (let trial = 0; trial < 40; trial++) {
      const start = performance.now();
      const lease = create();
      const creationMs = performance.now() - start;
      invoke(releaseArgs(lease));
      const totalMs = performance.now() - start;
      measurements.push({ trial, creationMs, totalMs });
    }
    const sorted = measurements.map((x) => x.totalMs).sort((a, b) => a - b);
    const percentile95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    outcomes.push({ case: 'cached_launch_performance_optional', result: 'PASS', n: 40,
      firstRunMs: measurements[0].totalMs, medianMs: sorted[19], p95Ms: percentile95,
      methodology: 'OS cache not cold-flushed; per-trial new process, synthetic-only' });
  }
  process.stdout.write(JSON.stringify({
    ok: true, syntheticOnly: true, r1CasesPassed: outcomes.length, skipped: skipped.length,
    cases: outcomes, skips: skipped, tempFixturesRetainedForReview: true,
    nativeR1BuildRequired: true, productionPathsTouched: false
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false, completed: outcomes, skips: skipped,
    code: String(error?.code ?? 'R1_SYNTHETIC_FAILED'),
    message: String(error?.message ?? error).slice(0, 350),
    tempFixturesRetainedForReview: true, productionPathsTouched: false
  }) + '\n');
  process.exitCode = 1;
}
