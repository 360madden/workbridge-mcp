import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, stat, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  parseDummyRequest, verifyFixedBuild, executeDummyOnce, classifyProvenNoInput, DummyClickError,
} from './run-dummy-once.mjs';

const sha = 'a'.repeat(64);
const args = (...mode) => [
  '--request-id', 'dummy_test_20261105a',
  '--dll-sha256', sha, '--confirm', 'one-disposable-flaui-click', ...mode,
];
const req = () => parseDummyRequest(args('--execute-once'));
const session = async () => ({ pid: 1234, sessionId: 1, startUtc: '2026-11-05T23:00:00.000Z' });
const verified = async () => ({ dll: 'fixed', sha256: sha, sizeBytes: 20000 });
const success = async () => ({ submitted: true, count: 1, nativeProof: true });
const fixture = async () => mkdtemp(path.join(tmpdir(), 'wb-flaui-dummy-'));
async function withFixture(fn) {
  const root = await fixture();
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('exact fixed dummy CLI rejects other targets, duplicate mode, and missing confirmation', () => {
  const r = req();
  assert.equal(r.executeOnce, true);
  assert.equal(r.dllSha256, sha);
  for (const bad of [
    ['--request-id', 'dummy_test_20261105a', '--dll-sha256', sha, '--confirm', 'wrong', '--execute-once'],
    [...args('--execute-once'), '--preflight-only'],
    [...args('--execute-once'), '--execute-once'],
    [...args('--execute-once'), '--pid', '32156'],
  ]) assert.throws(() => parseDummyRequest(bad), DummyClickError);
  const p = parseDummyRequest(args('--preflight-only'));
  assert.equal(p.preflightOnly, true);
});

test('success creates exactly one dummy receipt, releases both locks, and replay never sends', async () => {
  await withFixture(async root => {
    let count = 0;
    const opts = { root, getSession: session, verifyDll: verified,
      sender: async () => { count++; return success(); } };
    const first = await executeDummyOnce(req(), opts);
    assert.equal(first.ok, true);
    assert.equal(first.count, 1);
    assert.equal(count, 1);
    const files = await readdir(root);
    assert(files.includes('flaui-dummy-singleton.intent.json'));
    assert(files.includes('flaui-dummy-dummy_test_20261105a.receipt.json'));
    assert(!files.includes('desktop-input-turn.lock'));
    assert(!files.includes('desktop-turn-admission.lock'));
    assert(!files.some(x => x.startsWith('desktop-turn-quarantine-')));
    const receipt = JSON.parse(await readFile(path.join(root, 'flaui-dummy-dummy_test_20261105a.receipt.json'), 'utf8'));
    assert.equal(receipt.nativeCount, 1);
    const repeated = await executeDummyOnce(req(), opts);
    assert.equal(repeated.replayed, true);
    assert.equal(repeated.submitted, false);
    assert.equal(count, 1);
  });
});

test('different request after singleton refuses without another sender', async () => {
  await withFixture(async root => {
    let count = 0;
    const opts = { root, getSession: session, verifyDll: verified,
      sender: async () => { count++; return success(); } };
    await executeDummyOnce(req(), opts);
    const second = parseDummyRequest([
      '--request-id', 'another_dummy_20261105b', '--dll-sha256', sha,
      '--confirm', 'one-disposable-flaui-click', '--execute-once',
    ]);
    await assert.rejects(() => executeDummyOnce(second, opts), { code: 'ACTION_RECOVERY_REQUIRED' });
    assert.equal(count, 1);
  });
});

test('post-intent sender failure quarantines and retains owner lock for manual recovery', async () => {
  await withFixture(async root => {
    const opts = { root, getSession: session, verifyDll: verified,
      sender: async () => { throw new Error('simulated uncertain native input'); } };
    await assert.rejects(() => executeDummyOnce(req(), opts), /simulated uncertain native input/);
    const files = await readdir(root);
    assert(files.includes('desktop-input-turn.lock'));
    assert(!files.includes('desktop-turn-admission.lock'));
    assert(files.some(x => x.startsWith('desktop-turn-quarantine-')));
    assert(files.includes('flaui-dummy-singleton.intent.json'));
    await assert.rejects(() => executeDummyOnce(req(), opts), { code: 'UI_TURN_RECOVERY_REQUIRED' });
  });
});

test('missing native counter proof quarantines; no silent successful receipt', async () => {
  await withFixture(async root => {
    const opts = { root, getSession: session, verifyDll: verified,
      sender: async () => ({ submitted: true, count: 0, nativeProof: false }) };
    await assert.rejects(() => executeDummyOnce(req(), opts), { code: 'ACTION_RECOVERY_REQUIRED' });
    const files = await readdir(root);
    assert(!files.some(x => x.endsWith('.receipt.json')));
    assert(files.some(x => x.startsWith('desktop-turn-quarantine-')));
  });
});

test('pre-intent build or session failure releases owned admission/turn and does not leave marker', async () => {
  await withFixture(async root => {
    const opts = { root, getSession: session,
      verifyDll: async () => { throw new DummyClickError('STALE_BUILD', 'synthetic'); },
      sender: success };
    await assert.rejects(() => executeDummyOnce(req(), opts), { code: 'STALE_BUILD' });
    assert.deepEqual(await readdir(root), []);
  });
  await withFixture(async root => {
    let reads = 0;
    const opts = { root, verifyDll: verified, getSession: async () => {
      reads++;
      return reads === 1 ? await session() : { pid: 1234, sessionId: 2, startUtc: '2026-11-05T23:00:00.000Z' };
    }, sender: success };
    await assert.rejects(() => executeDummyOnce(req(), opts), { code: 'SESSION_CHANGED' });
    assert.deepEqual(await readdir(root), []);
  });
});

test('existing foreign desktop turn lock refuses without overwriting', async () => {
  await withFixture(async root => {
    const lock = path.join(root, 'desktop-input-turn.lock');
    await writeFile(lock, 'foreign owner persists\n');
    const before = await readFile(lock, 'utf8');
    await assert.rejects(() => executeDummyOnce(req(), {
      root, getSession: session, verifyDll: verified, sender: success,
    }), { code: 'UI_TURN_BUSY' });
    assert.equal(await readFile(lock, 'utf8'), before);
    assert.deepEqual(await readdir(root), ['desktop-input-turn.lock']);
  });
});

test('foreign admission lock and quarantine stop all input without mutations', async () => {
  await withFixture(async root => {
    await writeFile(path.join(root, 'desktop-turn-admission.lock'), 'foreign admission\n');
    await assert.rejects(() => executeDummyOnce(req(), {
      root, getSession: session, verifyDll: verified, sender: success,
    }), { code: 'UI_TURN_BUSY' });
    assert.deepEqual(await readdir(root), ['desktop-turn-admission.lock']);
  });
  await withFixture(async root => {
    await writeFile(path.join(root, 'desktop-turn-quarantine-old.json'), '{}');
    await assert.rejects(() => executeDummyOnce(req(), {
      root, getSession: session, verifyDll: verified, sender: success,
    }), { code: 'UI_TURN_RECOVERY_REQUIRED' });
    assert.deepEqual(await readdir(root), ['desktop-turn-quarantine-old.json']);
  });
});

test('exact settled native zero-click failure is classified without replay or quarantine', async () => {
  const nativeError = Object.assign(new Error('exit code 4'), {
    code: 4, killed: false, signal: null,
    stdout: JSON.stringify({ ok: false, mode: 'dummy-live-once', count: 0,
      inputAttempted: false, code: 'DUMMY_EVIDENCE_FAILED' }),
  });
  assert.deepEqual(classifyProvenNoInput(nativeError), {
    submitted: false, count: 0, nativeProof: true, noInputVerified: true,
  });
  for (const altered of [
    { ...nativeError, killed: true },
    { ...nativeError, code: 1 },
    { ...nativeError, signal: 'SIGKILL' },
    { ...nativeError, stdout: JSON.stringify({ ok: false, mode: 'dummy-live-once',
      count: 0, inputAttempted: true, code: 'DUMMY_EVIDENCE_FAILED' }) },
    { ...nativeError, stdout: '{bad' },
  ]) assert.equal(classifyProvenNoInput(altered), null);
  await withFixture(async root => {
    let calls = 0;
    const opts = { root, getSession: session, verifyDll: verified,
      sender: async () => { calls++; return classifyProvenNoInput(nativeError); } };
    const result = await executeDummyOnce(req(), opts);
    assert.deepEqual({
      ok: result.ok, submitted: result.submitted, count: result.count, status: result.status,
    }, {
      ok: false, submitted: false, count: 0, status: 'NATIVE_DUMMY_NO_INPUT_ABORTED',
    });
    let files = await readdir(root);
    assert(!files.includes('desktop-input-turn.lock'));
    assert(!files.includes('desktop-turn-admission.lock'));
    assert(!files.some(x => x.startsWith('desktop-turn-quarantine-')));
    const receipt = JSON.parse(await readFile(path.join(root,
      'flaui-dummy-dummy_test_20261105a.receipt.json'), 'utf8'));
    assert.equal(receipt.noInputVerified, true);
    const replay = await executeDummyOnce(req(), opts);
    assert.equal(replay.status, 'PREVIOUS_DUMMY_NO_INPUT_DO_NOT_REPEAT');
    assert.equal(calls, 1);
  });
});

test('fixed DLL hash and source-freshness checks reject changed or stale build', async () => {
  await withFixture(async root => {
    const dll = path.join(root, 'FlaUIDummyClick.dll');
    const src = path.join(root, 'Program.cs');
    const projectFile = path.join(root, 'FlaUIDummyClick.csproj');
    await writeFile(dll, 'A'.repeat(20000));
    await writeFile(src, 'source');
    await writeFile(projectFile, '<Project/>');
    await assert.rejects(() => verifyFixedBuild(req(), { dll, source: src, projectFile }), {
      code: 'DLL_HASH_CHANGED',
    });
  });
});
