#!/usr/bin/env node
// Two ordinary ChatGPT conversations share a collision-safe rendezvous through Workbridge.
// This helper never creates AI agents or modifies Workbridge service/assignment state.
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROLE_A_LANES = ['A1', 'A2', 'A3', 'A4', 'A5', 'A6'];
export const ROLE_B_LANES = ['B7', 'B8', 'B9', 'B10', 'B11', 'B12'];
export const ALL_LANES = [...ROLE_A_LANES, ...ROLE_B_LANES];
export const DEFAULT_JOIN_TIMEOUT_MS = 240_000;
export const DEFAULT_WORKER_WAIT_MS = 140_000;
export const DEFAULT_HOLD_MS = 30_000;
const DEFAULT_BARRIER_DELAY_MS = 1_500;
const idPattern = /^[A-Za-z0-9_-]{1,100}$/;
const defaultRoot = () => path.join(process.cwd(), '.tools', 'dual-chat-runs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function validId(value, name) {
  if (typeof value !== 'string' || !idPattern.test(value)) throw new Error(`INVALID_${name.toUpperCase()}`);
  return value;
}

async function ensureSafeDirectory(destination) {
  const absolute = path.resolve(destination);
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      await mkdir(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('UNSAFE_STATE_DIRECTORY');
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeExclusive(file, value) {
  const handle = await open(file, 'wx');
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function paths(runId, root = defaultRoot()) {
  validId(runId, 'run_id');
  const runDirectory = path.join(path.resolve(root), runId);
  return {
    runDirectory,
    claim: (role) => path.join(runDirectory, `coordinator-${role}`, 'claim.json'),
    roleDirectory: (role) => path.join(runDirectory, `coordinator-${role}`),
    lane: (lane) => path.join(runDirectory, 'lanes', lane),
    barrier: path.join(runDirectory, 'barrier.json'),
  };
}

async function claims(p) {
  const [a, b] = await Promise.all([readJson(p.claim('A')), readJson(p.claim('B'))]);
  return { A: a, B: b };
}

function checkAge(first) {
  if (first && Date.now() - Date.parse(first.joinedAt) > DEFAULT_JOIN_TIMEOUT_MS) {
    throw new Error('RUN_EXPIRED_USE_NEW_RUN_ID');
  }
}

export async function join(runId, options = {}) {
  const participantId = validId(options.participantId ?? randomUUID(), 'participant_id');
  const p = paths(runId, options.root);
  await ensureSafeDirectory(p.runDirectory);
  const before = await claims(p);
  checkAge(before.A);
  for (const role of ['A', 'B']) {
    if (before[role]?.participantId === participantId) {
      return { kind: 'coordinator-join', runId, role, participantId, replayed: true };
    }
  }
  for (const role of ['A', 'B']) {
    try {
      await mkdir(p.roleDirectory(role)); // Atomic across Edge chats/processes on Windows.
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    const joinedAt = new Date().toISOString();
    await writeExclusive(p.claim(role), { schemaVersion: 1, role, participantId, joinedAt });
    return { kind: 'coordinator-join', runId, role, participantId, joinedAt, replayed: false };
  }
  throw new Error('RUN_ALREADY_HAS_TWO_COORDINATORS');
}

async function verifyOwner(p, participantId) {
  validId(participantId, 'participant_id');
  const both = await claims(p);
  const role = ['A', 'B'].find((r) => both[r]?.participantId === participantId);
  if (!role) throw new Error('COORDINATOR_IDENTITY_MISMATCH');
  checkAge(both.A);
  return { role, both };
}

export async function waitPeer(runId, participantId, options = {}) {
  const p = paths(runId, options.root);
  const timeoutMs = options.timeoutMs ?? DEFAULT_JOIN_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_JOIN_TIMEOUT_MS) {
    throw new Error('INVALID_PEER_TIMEOUT');
  }
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { role, both } = await verifyOwner(p, participantId);
    if (both.A && both.B) {
      return {
        kind: 'peer-ready',
        runId,
        role,
        peerRole: role === 'A' ? 'B' : 'A',
        readyAt: new Date().toISOString(),
      };
    }
    await pause(300);
  }
  throw new Error('PEER_TIMEOUT_USE_NEW_RUN_ID');
}

function validateLane(role, number) {
  if (role !== 'A' && role !== 'B') throw new Error('INVALID_ROLE');
  const lane = `${role}${number}`;
  if (!(role === 'A' ? ROLE_A_LANES : ROLE_B_LANES).includes(lane)) throw new Error('INVALID_LANE');
  return lane;
}

export async function runLane(runId, participantId, role, number, options = {}) {
  const p = paths(runId, options.root);
  const lane = validateLane(role, number);
  const waitMs = options.waitMs ?? DEFAULT_WORKER_WAIT_MS;
  const holdMs = options.holdMs ?? DEFAULT_HOLD_MS;
  const barrierDelayMs = options.barrierDelayMs ?? DEFAULT_BARRIER_DELAY_MS;
  if (
    ![waitMs, holdMs, barrierDelayMs].every((v) => Number.isInteger(v) && v >= 1) ||
    waitMs > 300_000 ||
    holdMs > 120_000 ||
    barrierDelayMs > 10_000
  ) {
    throw new Error('INVALID_TIMING');
  }
  const owner = await verifyOwner(p, participantId);
  if (owner.role !== role || !owner.both.A || !owner.both.B) throw new Error('ROLE_NOT_READY');
  await ensureSafeDirectory(path.join(p.runDirectory, 'lanes'));
  try {
    await mkdir(p.lane(lane));
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('LANE_ALREADY_CLAIMED_CHECK_ORIGINAL_JOB');
    throw error;
  }
  const registeredAt = new Date().toISOString();
  await writeExclusive(path.join(p.lane(lane), 'registered.json'), {
    schemaVersion: 1,
    runId,
    lane,
    role,
    participantId,
    pid: process.pid,
    registeredAt,
  });
  const deadline = Date.now() + waitMs;
  let barrier;
  while (Date.now() < deadline) {
    barrier = await readJson(p.barrier);
    if (barrier) break;
    const registered = await Promise.all(
      ALL_LANES.map((name) => readJson(path.join(p.lane(name), 'registered.json'))),
    );
    if (registered.every((record, index) => record?.lane === ALL_LANES[index])) {
      try {
        await writeExclusive(p.barrier, {
          schemaVersion: 1,
          runId,
          goAt: new Date(Date.now() + barrierDelayMs).toISOString(),
          holdMs,
          releasedBy: lane,
        });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    }
    await pause(100);
  }
  if (!barrier) throw new Error('TWELVE_LANE_BARRIER_TIMEOUT');
  if (barrier.runId !== runId || barrier.holdMs !== holdMs || !Number.isFinite(Date.parse(barrier.goAt))) {
    throw new Error('BARRIER_MISMATCH');
  }
  await pause(Math.max(0, Date.parse(barrier.goAt) - Date.now()));
  const startedAt = new Date().toISOString();
  process.stdout.write(
    `${JSON.stringify({ phase: 'start', runId, lane, pid: process.pid, utc: startedAt })}\n`,
  );
  await pause(holdMs);
  const endedAt = new Date().toISOString();
  process.stdout.write(`${JSON.stringify({ phase: 'end', runId, lane, pid: process.pid, utc: endedAt })}\n`);
  const receipt = {
    schemaVersion: 1,
    runId,
    lane,
    pid: process.pid,
    registeredAt,
    startedAt,
    endedAt,
    exitCode: 0,
  };
  await writeExclusive(path.join(p.lane(lane), 'done.json'), receipt);
  return receipt;
}

export async function status(runId, options = {}) {
  const p = paths(runId, options.root);
  const both = await claims(p);
  const lanes = await Promise.all(
    ALL_LANES.map(async (lane) => ({
      lane,
      registered: Boolean(await readJson(path.join(p.lane(lane), 'registered.json'))),
      done: await readJson(path.join(p.lane(lane), 'done.json')),
    })),
  );
  return {
    kind: 'dual-chat-status',
    runId,
    coordinators: { A: Boolean(both.A), B: Boolean(both.B) },
    barrier: await readJson(p.barrier),
    registered: lanes.filter((l) => l.registered).length,
    completed: lanes.filter((l) => l.done?.exitCode === 0).length,
    lanes,
  };
}

async function main() {
  const [command, runId, ...args] = process.argv.slice(2);
  if (!command || !runId)
    throw new Error(
      'USAGE: join RUN_ID | wait RUN_ID PARTICIPANT_ID | lane RUN_ID PARTICIPANT_ID A|B NUMBER | status RUN_ID',
    );
  let result;
  switch (command) {
    case 'join':
      if (args.length) throw new Error('INVALID_ARGUMENTS');
      result = await join(runId);
      break;
    case 'wait':
      if (args.length !== 1) throw new Error('INVALID_ARGUMENTS');
      result = await waitPeer(runId, args[0]);
      break;
    case 'lane':
      if (args.length !== 3) throw new Error('INVALID_ARGUMENTS');
      result = await runLane(runId, args[0], args[1], Number(args[2]));
      break;
    case 'status':
      if (args.length) throw new Error('INVALID_ARGUMENTS');
      result = await status(runId);
      break;
    default:
      throw new Error('UNKNOWN_COMMAND');
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`dual-chat-test: ${error.message}\n`);
    process.exitCode = 1;
  });
}
