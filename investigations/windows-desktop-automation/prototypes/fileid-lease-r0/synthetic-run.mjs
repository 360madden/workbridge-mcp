#!/usr/bin/env node
// Synthetic-only source harness. Four GUID temp fixtures, never production paths.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const executable = process.argv[2];
if (process.platform !== 'win32' || !executable || !path.isAbsolute(executable) ||
    !executable.toLowerCase().endsWith('.exe') || !existsSync(executable)) {
  throw new Error('A verified absolute Windows synthetic helper .exe path is required');
}
// Refuse a TMP/TEMP redirect into Workbridge .tools, C:\work or game roots.
const temp = path.resolve(os.tmpdir()).replaceAll('/', '\\').replace(/[\\]+$/, '').toLowerCase();
const normalizedTemp = temp + '\\';
if (!path.isAbsolute(temp) || normalizedTemp.startsWith('c:\\work\\') ||
    normalizedTemp.includes('\\workbridge-mcp\\') || normalizedTemp.includes('\\.tools\\') ||
    normalizedTemp.includes('\\.local\\') || normalizedTemp.includes('\\rift modding\\')) {
  throw new Error('UNSAFE_SYNTHETIC_TEMP_ROOT');
}
const expectedNativeTempSha = createHash('sha256').update(Buffer.from(temp, 'utf8')).digest('hex');
const makeId = () => randomUUID().replaceAll('-', '');
const folder = (id) => path.join(os.tmpdir(), 'workbridge-fileid-r0-' + id);
const lock = (id) => path.join(folder(id), 'synthetic-fileid-lease.lock');
const fixture = (id) => ['--fixture-id', id];
const releaseArgs = (created) => [
  'release', ...fixture(created.fixtureId), '--volume', created.volume,
  '--file-id', created.fileId, '--sha256', created.sha256, '--lease-id', created.leaseId
];
const jsonOutput = (result) => {
  const lines = result.stdout.trim().split('\n').filter(Boolean);
  assert.ok(lines.length <= 1, 'bounded single-line protocol');
  return lines.length ? JSON.parse(lines[0]) : null;
};
const run = (args, expectedStatus = 0) => {
  const result = spawnSync(executable, args, {
    encoding: 'utf8', windowsHide: true, shell: false,
    timeout: 8000, maxBuffer: 65536
  });
  assert.equal(result.error, undefined, 'owned child completed within bound');
  assert.equal(result.signal, null);
  assert.equal(result.status, expectedStatus, JSON.stringify({ args: args.map((x, i) =>
    i > 0 && ['--sha256', '--file-id', '--volume'].includes(args[i - 1]) ? '<token>' : x),
    stdout: result.stdout?.slice(0, 300), stderr: result.stderr?.slice(0, 100) }));
  const json = jsonOutput(result);
  if (expectedStatus === 0) assert.equal(json?.ok, true);
  return { status: result.status, json };
};
const runAsync = (args) => new Promise((resolve, reject) => {
  execFile(executable, args, {
    windowsHide: true, shell: false, timeout: 8000, maxBuffer: 65536,
    encoding: 'utf8'
  }, (error, stdout, stderr) => {
    if (error?.killed || error?.signal || typeof error?.code === 'string') {
      reject(new Error('owned synthetic contender failed to terminate normally'));
      return;
    }
    resolve({ status: error?.code ?? 0, json: jsonOutput({ stdout }), stderrLength: stderr.length });
  });
});

const outcomes = [];
try {
  // 1. Ordinary create -> FileId token -> native handle-bound release -> no replay.
  {
    const id = makeId();
    const created = run(['create', ...fixture(id)]).json;
    assert.equal(created.fixtureId, id);
    assert.equal(created.tempRootSha256, expectedNativeTempSha, 'native and Node temp roots must match');
    assert.match(created.fileId, /^[0-9a-f]{32}$/);
    assert.match(created.volume, /^[0-9a-f]{16}$/);
    assert.match(created.sha256, /^[0-9a-f]{64}$/);
    assert.equal(existsSync(lock(id)), true);
    const released = run(releaseArgs(created)).json;
    assert.equal(released.releasedOriginalId, created.fileId);
    assert.equal(existsSync(lock(id)), false);
    const replay = run(releaseArgs(created), 3).json;
    assert.equal(replay.code, 'SOURCE_OPEN_REFUSED');
    outcomes.push({ case: 'create_release_and_replay', result: 'PASS', fixtureId: id });
  }
  // 2. Move A away; copy exactly same contents into new B at canonical name.
  // Native release must reject B's different original FileId, preserving both.
  {
    const id = makeId();
    const created = run(['create', ...fixture(id)]).json;
    const original = await readFile(lock(id));
    const originalBackup = lock(id) + '.original';
    await rename(lock(id), originalBackup);
    await writeFile(lock(id), original, { flag: 'wx' });
    const mismatch = run(releaseArgs(created), 3).json;
    assert.equal(mismatch.code, 'IDENTITY_MISMATCH');
    assert.deepEqual(await readFile(lock(id)), original);
    assert.deepEqual(await readFile(originalBackup), original);
    outcomes.push({ case: 'foreign_same_bytes_replacement', result: 'PASS', fixtureId: id });
  }
  // 3. The owned helper exits immediately after a durable create without
  // producing a lease token. The lock must survive an absent owner.
  {
    const id = makeId();
    const aborted = run(['create', ...fixture(id), '--abort-after-fsync'], 91);
    assert.equal(aborted.json, null);
    assert.equal(existsSync(lock(id)), true);
    const denied = run(['create', ...fixture(id), '--existing-root'], 2).json;
    assert.equal(denied.code, 'LOCK_EXISTS');
    assert.ok((await readFile(lock(id))).length > 0);
    outcomes.push({ case: 'owner_process_abort_retains_name', result: 'PASS', fixtureId: id });
  }
  // 4. Two independently spawned helper children race CREATE_NEW in the
  // same explicitly synthetic root: exactly one can acquire the leaf.
  {
    const id = makeId();
    await mkdir(folder(id), { recursive: false });
    const contenders = await Promise.all([
      runAsync(['create', ...fixture(id), '--existing-root']),
      runAsync(['create', ...fixture(id), '--existing-root'])
    ]);
    assert.equal(contenders.filter((x) => x.status === 0 && x.json?.ok).length, 1);
    assert.equal(contenders.filter((x) => x.status === 2 && x.json?.code === 'LOCK_EXISTS').length, 1);
    assert.equal(existsSync(lock(id)), true);
    outcomes.push({ case: 'same_leaf_concurrent_create_new', result: 'PASS', fixtureId: id });
  }
  process.stdout.write(JSON.stringify({
    ok: true, syntheticOnly: true, casesPassed: outcomes.length, cases: outcomes,
    tempFixturesRetainedForReview: true, productionPathsTouched: false
  }) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false, completedCases: outcomes, code: String(error?.code ?? 'SYNTHETIC_ASSERTION_FAILED'),
    detail: String(error?.message ?? error).slice(0, 500),
    tempFixturesRetainedForReview: true, productionPathsTouched: false
  }) + '\n');
  process.exitCode = 1;
}
