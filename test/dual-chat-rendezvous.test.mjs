import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { join, waitPeer, runLane, status, ALL_LANES } from '../scripts/dual-chat-rendezvous.mjs';

const script = fileURLToPath(new URL('../scripts/dual-chat-rendezvous.mjs', import.meta.url));
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isolated(t) {
  const folder = await mkdtemp(path.join(tmpdir(), 'wb-dual-chat-test-'));
  t.after(async () => rm(folder, { recursive: true, force: true }));
  return folder;
}

function processCall(cwd, ...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { cwd, windowsHide: true });
    let stdout = '',
      stderr = '';
    child.stdout.setEncoding('utf8').on('data', (x) => {
      stdout += x;
    });
    child.stderr.setEncoding('utf8').on('data', (x) => {
      stderr += x;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(stdout.trim())) : reject(new Error(`${code}: ${stderr}`)),
    );
  });
}

test('concurrent independent processes atomically elect exactly A and B', async (t) => {
  const cwd = await isolated(t);
  const [first, second] = await Promise.all([
    processCall(cwd, 'join', 'two_clients'),
    processCall(cwd, 'join', 'two_clients'),
  ]);
  assert.deepEqual([first.role, second.role].sort(), ['A', 'B']);
  assert.notEqual(first.participantId, second.participantId);
  await assert.rejects(processCall(cwd, 'join', 'two_clients'), /RUN_ALREADY_HAS_TWO_COORDINATORS/);
});

test('join is idempotent for one participant and limits test role count to two', async (t) => {
  const root = await isolated(t);
  const first = await join('idempotence', { root, participantId: 'client_abc123' });
  assert.equal(first.role, 'A');
  const again = await join('idempotence', { root, participantId: 'client_abc123' });
  assert.equal(again.role, 'A');
  assert.equal(again.replayed, true);
  const second = await join('idempotence', { root, participantId: 'client_xyz789' });
  assert.equal(second.role, 'B');
  await assert.rejects(
    join('idempotence', { root, participantId: 'third_client123' }),
    /RUN_ALREADY_HAS_TWO_COORDINATORS/,
  );
});

test('A can wait while the human delays pasting into B', async (t) => {
  const root = await isolated(t);
  const a = await join('late_peer', { root });
  const waiting = waitPeer('late_peer', a.participantId, { root, timeoutMs: 1_500 });
  await delay(250);
  const b = await join('late_peer', { root });
  const [aReady, bReady] = await Promise.all([
    waiting,
    waitPeer('late_peer', b.participantId, { root, timeoutMs: 1_500 }),
  ]);
  assert.equal(aReady.role, 'A');
  assert.equal(aReady.peerRole, 'B');
  assert.equal(bReady.role, 'B');
  assert.equal(bReady.peerRole, 'A');
});

test('twelve independent lane reservations reach one shared timed barrier after a delayed B side', async (t) => {
  const root = await isolated(t);
  const a = await join('barrier', { root });
  const b = await join('barrier', { root });
  const opt = { root, waitMs: 3_000, holdMs: 100, barrierDelayMs: 250 };
  const aWorkers = [1, 2, 3, 4, 5, 6].map((n) => runLane('barrier', a.participantId, 'A', n, opt));
  await delay(180);
  const bWorkers = [7, 8, 9, 10, 11, 12].map((n) => runLane('barrier', b.participantId, 'B', n, opt));
  const results = await Promise.all([...aWorkers, ...bWorkers]);
  assert.deepEqual(results.map((x) => x.lane).sort(), [...ALL_LANES].sort());
  const latestStart = Math.max(...results.map((x) => Date.parse(x.startedAt)));
  const earliestEnd = Math.min(...results.map((x) => Date.parse(x.endedAt)));
  assert.ok(earliestEnd > latestStart, 'all 12 lanes should share a positive active overlap');
  const final = await status('barrier', { root });
  assert.equal(final.registered, 12);
  assert.equal(final.completed, 12);
  assert.ok(final.barrier?.goAt);
});

test('unregistered lanes time out instead of occupying slots indefinitely', async (t) => {
  const root = await isolated(t);
  const a = await join('missing_worker', { root });
  await join('missing_worker', { root });
  await assert.rejects(
    runLane('missing_worker', a.participantId, 'A', 1, { root, waitMs: 150, holdMs: 10, barrierDelayMs: 20 }),
    /TWELVE_LANE_BARRIER_TIMEOUT/,
  );
  const result = await status('missing_worker', { root });
  assert.equal(result.registered, 1);
  assert.equal(result.completed, 0);
});

test('invalid run IDs and incorrect coordinator ownership are rejected', async (t) => {
  const root = await isolated(t);
  await assert.rejects(join('../escape', { root }), /INVALID_RUN_ID/);
  const a = await join('ownership', { root });
  await join('ownership', { root });
  await assert.rejects(
    runLane('ownership', a.participantId, 'B', 7, { root, waitMs: 50, holdMs: 5 }),
    /ROLE_NOT_READY/,
  );
  await assert.rejects(
    waitPeer('ownership', 'other_client', { root, timeoutMs: 50 }),
    /COORDINATOR_IDENTITY_MISMATCH/,
  );
});
