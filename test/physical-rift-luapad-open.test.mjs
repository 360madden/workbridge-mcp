import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openLuaPadOnce, parseRequest } from '../scripts/physical-rift-luapad-open.mjs';

const START = '2026-11-05T15:31:50.6416621Z';
function request(id = 'luapad_test_once_0001') {
  return {
    pid: 32156, hwnd: 462734, startedUtc: START, requestId: id,
    executeOnce: true, preflightOnly: false,
    chatVisualAttestation: 'chat-closed-empty', editorVisualAttestation: 'luapad-closed',
    screenshotRequestId: 'test_capture_0001',
  };
}
function mock(input = {}) {
  let foreground = false;
  const sent = [];
  const runner = async (args) => {
    if (args[0] === '--version') return 'winapp 0.7.1';
    const op = args[1];
    if (op === 'list-windows') return JSON.stringify([{
      hwnd: 462734, processId: 32156, processName: 'rift_x64', title: 'RIFT',
      className: 'TWNClientFramework', ownerHwnd: 0, isForeground: foreground,
      width: 1936, height: 1048,
    }]);
    if (op === 'inspect') return JSON.stringify({ windows: [{
      hwnd: 462734, elements: [{
        type: 'Window', name: 'RIFT', className: 'TWNClientFramework',
        isEnabled: true, isOffscreen: false, x: 0, y: 0, width: 1936, height: 1048,
        selector: 'win-rift-test',
      }],
    }] });
    if (op === 'focus') {
      foreground = true;
      return JSON.stringify({ ok: true, hwnd: 462734 });
    }
    if (op === 'send-keys') {
      if (input.failAt === sent.length) throw new Error('Synthetic sender failure');
      sent.push(args[2]);
      return JSON.stringify({ via: 'send-input', keys: args[2], hwnd: 462734,
        actionCount: 1, warnings: [], target: 'RIFT' });
    }
    throw new Error('Unexpected runner arguments: ' + args.join(' '));
  };
  const getProcess = async (pid) => ({
    pid, startedUtc: pid === 32156 ? START : '2026-11-05T16:00:00.000Z',
    sessionId: 1,
  });
  return { runner, getProcess, sent };
}
function evidence(now = Date.now()) {
  return { confirmed: true, state: 'chat-closed-empty',
    pid: 32156, hwnd: 462734, startedUtc: START, sessionId: 1,
    imageSha256: 'a'.repeat(64), capturedUtc: new Date(now - 1000).toISOString() };
}
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lp-guard-test-'));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('requires exact target, confirmation, one mode and fresh screenshot intent', () => {
  const args = ['--pid', '32156', '--hwnd', '462734', '--started-utc', START,
    '--request-id', 'luapad_test_once_0001', '--confirm', 'one-physical-rift-luapad-open',
    '--execute-once', '--screenshot-request-id', 'test_capture_0001',
    '--chat-visual-attestation', 'chat-closed-empty',
    '--editor-visual-attestation', 'luapad-closed'];
  assert.equal(parseRequest(args).executeOnce, true);
  assert.throws(() => parseRequest(args.slice(0, -2)), /Fresh capture/);
  assert.throws(() => parseRequest(args.map((x) => x === 'luapad-closed' ? 'luapad-open' : x)), /Fresh capture/);
  assert.throws(() => parseRequest([...args, '--pid', '1']), /Repeated/);
  assert.throws(() => parseRequest(args.map((x) => x === 'one-physical-rift-luapad-open' ? 'wrong' : x)), /confirmation/);
  assert.throws(() => parseRequest([...args, '--preflight-only']), /one mode/);
  assert.throws(() => parseRequest(args.map((x) => x === '32156' ? '0' : x)), /positive decimal/);
});

test('exact three-key /lp transaction and replay without any repeat input', async () => fixture(async (root) => {
  const f = mock(), req = request();
  const result = await openLuaPadOnce(req, { root, ...f, evidence: evidence(), settle: async () => {} });
  assert.equal(result.submitted, true);
  assert.deepEqual(f.sent, ['enter', '/lp', 'enter']);
  const names = await readdir(root);
  assert.ok(names.includes('physical-rift-luapad-open-singleton.intent.json'));
  assert.ok(names.some((n) => n.endsWith('.receipt.json')));
  assert.ok(!names.includes('desktop-input-turn.lock'));
  assert.ok(!names.includes('desktop-turn-admission.lock'));
  const receipt = JSON.parse(await readFile(path.join(root, names.find((n) => n.endsWith('.receipt.json'))), 'utf8'));
  assert.equal(receipt.verified, false);
  const replay = await openLuaPadOnce(req, { root, ...f, evidence: evidence(), settle: async () => {} });
  assert.equal(replay.replayed, true);
  assert.deepEqual(f.sent, ['enter', '/lp', 'enter']);
}));

test('stale screenshot refuses before intent and releases admission', async () => fixture(async (root) => {
  const f = mock();
  const stale = evidence(Date.now() - 65000);
  await assert.rejects(
    openLuaPadOnce(request(), { root, ...f, evidence: stale, settle: async () => {} }),
    /Initial visual evidence stale/,
  );
  assert.deepEqual(f.sent, []);
  assert.deepEqual(await readdir(root), []);
}));

test('uncertain sender failure retains turn and quarantine; no blind retry', async () => fixture(async (root) => {
  const f = mock({ failAt: 1 });
  await assert.rejects(openLuaPadOnce(request(), {
    root, ...f, evidence: evidence(), settle: async () => {},
  }), /Synthetic sender failure/);
  const names = await readdir(root);
  assert.ok(names.includes('desktop-input-turn.lock'));
  assert.ok(names.some((n) => /^desktop-turn-quarantine-.*\.json$/.test(n)));
  assert.deepEqual(f.sent, ['enter']);
  await assert.rejects(openLuaPadOnce(request('luapad_test_once_0002'), {
    root, ...f, evidence: evidence(), settle: async () => {},
  }), /quarantine/);
  assert.deepEqual(f.sent, ['enter']);
}));
