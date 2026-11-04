import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const fixtureDir = fileURLToPath(new URL('.', import.meta.url));
const repo = path.resolve(fixtureDir, '../../../..');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withDeadline(promise, timeoutMs, purpose) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out waiting for ' + purpose)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer); // A successful race must not keep Node alive for five more seconds.
  }
}

async function waitUntil(check, timeoutMs, purpose) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if (await check()) return;
    await delay(25);
  }
  throw new Error('Timed out waiting for synthetic ' + purpose);
}

function waitForReady(host, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let settled = false;
    const timer = setTimeout(() => finish(new Error('Synthetic host did not announce its child')), timeoutMs);
    function cleanup() {
      clearTimeout(timer);
      host.stdout.off('data', onData);
      host.off('close', onClose);
      host.off('error', onError);
    }
    function finish(error, workerPid) {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve(workerPid);
    }
    function onData(chunk) {
      buffer += chunk.toString('utf8');
      if (buffer.length > 4096) return finish(new Error('Synthetic host output overflow'));
      const match = /^HOST:(\d+):CHILD:(\d+):ACTIVE:(\d+):MODE:(hang-before-effect|effect-then-hang)\r?\n/m.exec(buffer);
      if (match) {
        finish(null, {
          hostPid: Number(match[1]),
          workerPid: Number(match[2]),
          activeCount: Number(match[3]),
          mode: match[4],
        });
      }
    }
    function onClose(code) {
      finish(new Error('Synthetic host exited before readiness, exit=' + code));
    }
    function onError(error) {
      finish(error);
    }
    host.stdout.on('data', onData);
    host.on('close', onClose);
    host.on('error', onError);
  });
}

async function readJournal(file) {
  let content;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    return content.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return null; // Malformed evidence must remain inconclusive.
  }
}

async function readMarker(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// This inference is valid ONLY for this controlled fixture. Its exhaustive
// contract says the single effect is a durably flushed, exclusive marker.
// Absence of a marker in a third-party application cannot prove nonexecution.
function classifyFixture(events, marker, treeSettled, workerPid, mode) {
  if (!treeSettled || !Number.isSafeInteger(workerPid) || workerPid <= 0 ||
      !['hang-before-effect', 'effect-then-hang'].includes(mode) || !Array.isArray(events)) {
    return 'unknown_outcome';
  }
  if (!events.every((event) =>
    event.schemaVersion === 1 && event.pid === workerPid && event.mode === mode &&
    typeof event.utc === 'string' && Number.isFinite(Date.parse(event.utc)) &&
    ['dispatch_entered', 'effect_committed'].includes(event.stage))) {
    return 'unknown_outcome';
  }
  const sequence = events.map((event) => event.stage).join(',');
  if (mode === 'effect-then-hang' && marker === '1\n' &&
      sequence === 'dispatch_entered,effect_committed') return 'verified_success';
  if (mode === 'hang-before-effect' && marker === null &&
      sequence === 'dispatch_entered') return 'verified_failure';
  return 'unknown_outcome';
}

function isGone(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    if (error.code === 'ESRCH') return true;
    throw error;
  }
}

async function terminateAndVerifyOwnedHost(host, workerPid) {
  if (host.exitCode === null && host.signalCode === null) {
    const closed = once(host, 'close');
    assert.equal(host.kill(), true, 'Terminate only the owned spawn() host handle');
    await withDeadline(closed, 5000, 'synthetic host close');
  }
  if (!Number.isSafeInteger(workerPid) || workerPid <= 0) {
    throw new Error('Child identity unknown; retain temp evidence for manual review');
  }
  await waitUntil(() => isGone(workerPid), 3000, 'verified child settlement');
}

test(
  'synthetic hangs preserve independent before/after evidence and terminate owned descendants',
  { skip: process.platform !== 'win32', timeout: 45000 },
  async () => {
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    const compiler = (
      await Promise.all(['Framework64', 'Framework'].map(async (arch) => {
        const candidate = path.join(windows, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe');
        return fs.access(candidate).then(() => candidate, () => null);
      }))
    ).find(Boolean);
    assert.ok(compiler, 'Existing Windows .NET Framework csc.exe is required; no install permitted');

    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-desktop-hang-'));
    let safeToRemove = true;
    try {
      const executable = path.join(temporary, 'Desktop Synthetic Hang Smoke.exe');
      await run(
        compiler,
        [
          '/nologo',
          '/target:exe',
          '/optimize+',
          '/out:' + executable,
          path.join(repo, 'scripts', 'Desktop-JobLifetime.cs'),
          path.join(fixtureDir, 'HangSmoke.cs'),
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 8192 },
      );

      for (const [mode, expected] of [
        ['hang-before-effect', 'verified_failure'],
        ['effect-then-hang', 'verified_success'],
      ]) {
        const caseStarted = Date.now();
        const caseDir = path.join(temporary, mode);
        await fs.mkdir(caseDir);
        const journalFile = path.join(caseDir, 'journal.jsonl');
        const markerFile = path.join(caseDir, 'effect.marker');
        const host = spawn(executable, ['host', mode, caseDir], {
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let workerPid;
        let treeSettled = false;
        try {
          const ready = await waitForReady(host);
          workerPid = ready.workerPid;
          assert.equal(ready.hostPid, host.pid, 'Native owner identity must match the spawned host');
          assert.equal(ready.mode, mode, 'Native owner must report the selected test mode');
          assert.equal(ready.activeCount, 2, 'Job accounting must include the host and blocked child');
          assert.ok(Number.isSafeInteger(workerPid) && workerPid > 0);
          // Independent observer waits for complete, identity-bound evidence.
          await waitUntil(async () => {
            const events = await readJournal(journalFile);
            const marker = await readMarker(markerFile);
            return events?.some((event) =>
              event.schemaVersion === 1 && event.pid === workerPid && event.mode === mode &&
              event.stage === 'dispatch_entered') &&
              (mode === 'hang-before-effect' ||
                (marker === '1\n' && events.some((event) =>
                  event.pid === workerPid && event.mode === mode &&
                  event.stage === 'effect_committed')));
          }, 5000, mode + ' identity-bound evidence');

          assert.equal(isGone(workerPid), false, 'Blocked child must still be alive just before kill');
          await terminateAndVerifyOwnedHost(host, workerPid);
          treeSettled = true;
          assert.ok(Date.now() - caseStarted < 30000, 'Containment must finish before worker sleep expires');
          const events = await readJournal(journalFile);
          const marker = await readMarker(markerFile);
          const outcome = classifyFixture(events, marker, treeSettled, workerPid, mode);
          assert.equal(outcome, expected);
          assert.equal(events.filter((event) => event.stage === 'effect_committed').length,
            mode === 'effect-then-hang' ? 1 : 0);
          process.stdout.write('SYNTHETIC:' + mode + ':' + outcome + ':tree_settled:job_members=2\n');
        } finally {
          if (!treeSettled) {
            try {
              await terminateAndVerifyOwnedHost(host, workerPid);
            } catch (error) {
              safeToRemove = false;
              process.stderr.write('SYNTHETIC_RECOVERY_REQUIRED: owned host/child settlement unverified\n');
            }
          }
        }
      }

      const observed = {
        schemaVersion: 1, pid: 321, mode: 'hang-before-effect',
        stage: 'dispatch_entered', utc: '2026-11-04T21:00:00.000Z',
      };
      assert.equal(classifyFixture(null, null, true, 321, observed.mode), 'unknown_outcome');
      assert.equal(classifyFixture([observed], null, false, 321, observed.mode), 'unknown_outcome');
      assert.equal(classifyFixture([observed, observed], null, true, 321, observed.mode), 'unknown_outcome');
      assert.equal(classifyFixture([observed], null, true, 999, observed.mode), 'unknown_outcome');
      assert.equal(classifyFixture(
        [{ ...observed, stage: 'effect_committed' }], null, true, 321, observed.mode),
      'unknown_outcome');
    } finally {
      assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
      assert.ok(path.basename(temporary).startsWith('wb-desktop-hang-'));
      if (safeToRemove) {
        await fs.rm(temporary, { recursive: true, force: true });
      } else {
        process.stderr.write('SYNTHETIC_QUARANTINED: preserved owned temp evidence at ' + temporary + '\n');
      }
    }
  },
);
