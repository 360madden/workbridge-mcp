import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseActionRequest, invokeProbeOnce } from '../scripts/desktop-probe-act.mjs';

// Resolve the source runner for this import only; no build or dist mutation.
const adapterUrl = new URL('../src/desktop-probe-action-tool.ts', import.meta.url).href;
const hook = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === adapterUrl && specifier === './desktop-cli-runner.js') {
      return { url: new URL('../src/desktop-cli-runner.ts', import.meta.url).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
let desktopProbeAction, DesktopProbeActionError, DESKTOP_PROBE_ACTION_DESCRIPTION;
try {
  ({ desktopProbeAction, DesktopProbeActionError, DESKTOP_PROBE_ACTION_DESCRIPTION } = await import(
    adapterUrl
  ));
} finally {
  hook.deregister();
}

const request = {
  pid: 9911,
  hwnd: 224466,
  requestId: 'worker13_action_001',
  expectedCount: 0,
  method: 'uia',
};

function receipt() {
  return {
    ...request,
    ok: true,
    schemaVersion: 1,
    replayed: false,
    selector: 'IncrementButton',
    startedUtc: '2026-10-26T12:00:00.000Z',
    completedUtc: '2026-10-26T12:00:00.100Z',
    afterCount: 1,
    reportedHwnd: request.hwnd,
    handleRelationship: 'top-level',
    action: 'invoke',
    inputMethod: 'UIAutomation.InvokePattern',
    osMouseKeyboardInjected: false,
  };
}

function typed(code, outcome) {
  return (error) => {
    assert.ok(error instanceof DesktopProbeActionError);
    assert.equal(error.code, code);
    assert.equal(error.outcome, outcome);
    return true;
  };
}

test('UIA adapter pins the pilot, exact guards, bounds and safe receipt fields', async () => {
  let calls = 0;
  const result = await desktopProbeAction(request, async (script, args, options) => {
    calls++;
    assert.equal(script, 'desktop-probe-act.mjs');
    assert.deepEqual(options, { timeoutMs: 45_000, maxOutputBytes: 16 * 1024 });
    const parsed = parseActionRequest(args);
    assert.equal(parsed.target.pid, request.pid);
    assert.equal(parsed.target.hwnd, request.hwnd);
    assert.equal(parsed.target.process, 'DesktopProbe');
    assert.equal(parsed.target.title, 'Workbridge GUI-004 Native Input Probe');
    assert.equal(parsed.expectedCount, 0);
    assert.equal(parsed.requestId, request.requestId);
    assert.equal(parsed.method, 'uia');
    return { ...receipt(), secret: 'do not forward', rawOutput: 'private' };
  });
  assert.equal(calls, 1);
  assert.deepEqual(result, {
    ...receipt(),
    foregroundMayChange: true,
    foregroundRestorationGuaranteed: false,
  });
  assert.match(DESKTOP_PROBE_ACTION_DESCRIPTION, /shared desktop GUI turn/);
  assert.match(DESKTOP_PROBE_ACTION_DESCRIPTION, /historical evidence/);
});

test('invalid requests and every alternative input surface fail before dispatch', async () => {
  const invalid = [
    [null, 'INVALID_ARGUMENTS'],
    [[], 'INVALID_ARGUMENTS'],
    ...[0, -1, 1.5, '9911', NaN, Infinity, 0x80000000].map((pid) => [{ ...request, pid }, 'INVALID_TARGET']),
    ...[0, -1, 1.5, '224466', Number.MAX_SAFE_INTEGER + 1].map((hwnd) => [
      { ...request, hwnd },
      'INVALID_TARGET',
    ]),
    ...['short', '../escape', '_action01', 'x'.repeat(65), 'action\n01', null].map((requestId) => [
      { ...request, requestId },
      'INVALID_REQUEST_ID',
    ]),
    ...[-1, 100, 0.5, '0', NaN, null].map((expectedCount) => [
      { ...request, expectedCount },
      'INVALID_EXPECTED_STATE',
    ]),
    ...['keyboard', 'mouse', 'UIA', undefined, null].map((method) => [
      { ...request, method },
      'INVALID_METHOD',
    ]),
    ...['selector', 'process', 'title', 'keys', 'x', 'vmx', 'root', 'args'].map((key) => [
      { ...request, [key]: 'redirect' },
      'INVALID_ARGUMENTS',
    ]),
  ];
  for (const [input, code] of invalid) {
    await assert.rejects(
      desktopProbeAction(input, async () => assert.fail('unexpected dispatch')),
      typed(code, 'not-dispatched'),
    );
  }
});

test('all malformed, stale and non-UIA success receipts remain uncertain without retry', async () => {
  const changes = [
    { ok: false },
    { ok: 'true' },
    { error: {} },
    { schemaVersion: 2 },
    { replayed: 1 },
    { pid: '9911' },
    { pid: 9912 },
    { hwnd: 224467 },
    { requestId: 'another_action' },
    { expectedCount: 1 },
    { method: 'keyboard' },
    { selector: 'ResetButton' },
    { action: 'click' },
    { inputMethod: 'WinApp pointer click' },
    { osMouseKeyboardInjected: true },
    { reportedHwnd: request.hwnd + 1 },
    { handleRelationship: 'verified-child' },
    { afterCount: 0 },
    { afterCount: 2 },
    { afterCount: '1' },
    { startedUtc: 'invalid' },
    { startedUtc: '2026-02-30T12:00:00.000Z' },
    { completedUtc: '2026-10-26T11:59:59.999Z' },
    { completedUtc: null },
  ];
  for (const source of [null, [], {}, ...changes.map((change) => ({ ...receipt(), ...change }))]) {
    let calls = 0;
    await assert.rejects(
      desktopProbeAction(request, async () => {
        calls++;
        return source;
      }),
      typed('ACTION_RECOVERY_REQUIRED', 'uncertain'),
    );
    assert.equal(calls, 1);
  }
  for (const key of Object.keys(receipt())) {
    const source = receipt();
    delete source[key];
    await assert.rejects(
      desktopProbeAction(request, async () => source),
      typed('ACTION_RECOVERY_REQUIRED', 'uncertain'),
    );
  }
});

test('sanitized typed stale failures differ from uncertain runner/transport failures', async () => {
  for (const code of [
    'STALE_TARGET',
    'ACTION_NOT_READY',
    'EXPECTED_STATE_MISMATCH',
    'UI_TURN_BUSY',
    'REQUEST_ID_CONFLICT',
    'DESKTOP_TIMEOUT',
    'DESKTOP_PROCESS_FAILED',
    'ACTION_RECOVERY_REQUIRED',
    'PROBE_IDENTITY_CHANGED',
    'private-secret',
  ]) {
    let calls = 0;
    const certain = [
      'STALE_TARGET',
      'ACTION_NOT_READY',
      'EXPECTED_STATE_MISMATCH',
      'UI_TURN_BUSY',
      'REQUEST_ID_CONFLICT',
    ].includes(code);
    await assert.rejects(
      desktopProbeAction(request, async () => {
        calls++;
        throw Object.assign(new Error('private-secret'), { code });
      }),
      (error) => {
        typed(certain ? code : 'ACTION_RECOVERY_REQUIRED', certain ? 'not-dispatched' : 'uncertain')(error);
        assert.equal(error.requestId, request.requestId);
        assert.doesNotMatch(JSON.stringify(error) + error.message, /private-secret/);
        if (!certain) assert.match(error.message, /do not resend with a new request ID/);
        return true;
      },
    );
    assert.equal(calls, 1);
  }
});

test('snapshot guards survive caller mutation and replay keeps historical timestamps', async () => {
  const input = { ...request };
  const source = { ...receipt(), replayed: true };
  const result = await desktopProbeAction(input, async () => {
    input.pid++;
    input.requestId = 'changed_request';
    input.expectedCount++;
    input.method = 'mouse';
    return source;
  });
  assert.equal(result.replayed, true);
  assert.equal(result.pid, request.pid);
  assert.equal(result.completedUtc, source.completedUtc);
});

test('upper expected counter boundary verifies exactly one increment', async () => {
  const result = await desktopProbeAction({ ...request, expectedCount: 99 }, async () => ({
    ...receipt(),
    expectedCount: 99,
    afterCount: 100,
  }));
  assert.equal(result.afterCount, 100);
});

async function fixture(t, { stale = false, uncertain = false, unchanged = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-worker13-uia-'));
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('wb-worker13-uia-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const log = path.join(root, `native-probe-${request.pid}.jsonl`);
  const event = async (stage, counter) =>
    appendFile(
      log,
      JSON.stringify({
        pid: request.pid,
        hwnd: request.hwnd,
        stage,
        counter,
        utc: new Date().toISOString(),
      }) + '\n',
    );
  await event('shown', 0);
  const calls = [];
  const win = {
    hwnd: request.hwnd,
    processId: request.pid,
    processName: 'DesktopProbe',
    title: 'Workbridge GUI-004 Native Input Probe',
    className: 'WinFormsTest',
    width: stale ? 160 : 720,
    height: stale ? 28 : 460,
    isForeground: true,
  };
  const fakeWinapp = async (args) => {
    calls.push(args);
    if (args[0] === '--version') return '0.7.1';
    if (args[1] === 'list-windows') return JSON.stringify([win]);
    if (args[1] === 'inspect')
      return JSON.stringify({
        windows: [
          {
            hwnd: win.hwnd,
            elements: [
              {
                selector: 'IncrementButton',
                type: 'Button',
                isEnabled: true,
                isOffscreen: false,
                isInvokable: true,
              },
            ],
          },
        ],
      });
    assert.deepEqual(args, [
      'ui',
      'invoke',
      'IncrementButton',
      '-w',
      String(request.hwnd),
      '--action',
      'invoke',
      '--json',
    ]);
    if (!unchanged) await event('incremented', 1);
    if (uncertain) throw new Error('lost response after increment');
    return JSON.stringify({ hwnd: request.hwnd, performedAction: 'invoke' });
  };
  const runner = async (script, args) => {
    assert.equal(script, 'desktop-probe-act.mjs');
    return invokeProbeOnce(parseActionRequest(args), {
      root,
      runner: fakeWinapp,
      handleInspector: async () => assert.fail('UIA needs no child-handle inspection'),
    });
  };
  const increments = async () =>
    (await readFile(log, 'utf8'))
      .trim()
      .split('\n')
      .map(JSON.parse)
      .filter((e) => e.stage === 'incremented');
  return { root, runner, calls, increments };
}

test('offline pilot fixture journals one native increment and completed replay never reinvokes', async (t) => {
  const f = await fixture(t);
  const first = await desktopProbeAction(request, f.runner);
  const replay = await desktopProbeAction(request, f.runner);
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(first.afterCount, 1);
  assert.equal((await f.increments()).length, 1);
  assert.equal(f.calls.filter((args) => args[1] === 'invoke').length, 1);
  const saved = JSON.parse(await readFile(path.join(f.root, `ui-action-${request.requestId}.json`), 'utf8'));
  assert.equal(saved.afterCount, 1);
  assert.equal(saved.completedUtc, replay.completedUtc);
  await assert.rejects(
    desktopProbeAction({ ...request, expectedCount: 1 }, f.runner),
    typed('REQUEST_ID_CONFLICT', 'not-dispatched'),
  );
  assert.equal((await f.increments()).length, 1);
});

test('offline stale window and stale native count fail without input', async (t) => {
  const f = await fixture(t, { stale: true });
  await assert.rejects(desktopProbeAction(request, f.runner), typed('STALE_TARGET', 'not-dispatched'));
  assert.equal(f.calls.filter((args) => args[1] === 'invoke').length, 0);
  const fresh = await fixture(t);
  await assert.rejects(
    desktopProbeAction({ ...request, expectedCount: 3 }, fresh.runner),
    typed('EXPECTED_STATE_MISMATCH', 'not-dispatched'),
  );
  assert.equal((await fresh.increments()).length, 0);
});

test('offline lost response preserves intent and same-ID retry cannot duplicate input', async (t) => {
  const f = await fixture(t, { uncertain: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    await assert.rejects(
      desktopProbeAction(request, f.runner),
      typed('ACTION_RECOVERY_REQUIRED', 'uncertain'),
    );
  }
  assert.equal((await f.increments()).length, 1);
  assert.equal(f.calls.filter((args) => args[1] === 'invoke').length, 1);
  const intent = JSON.parse(
    await readFile(path.join(f.root, `ui-action-${request.requestId}.intent.json`), 'utf8'),
  );
  assert.equal(intent.requestId, request.requestId);
  await assert.rejects(readFile(path.join(f.root, `ui-action-${request.requestId}.json`)), {
    code: 'ENOENT',
  });
});

test('offline success metadata without native counter evidence remains uncertain', async (t) => {
  const f = await fixture(t, { unchanged: true });
  await assert.rejects(desktopProbeAction(request, f.runner), typed('ACTION_RECOVERY_REQUIRED', 'uncertain'));
  assert.equal((await f.increments()).length, 0);
  await assert.rejects(desktopProbeAction(request, f.runner), typed('ACTION_RECOVERY_REQUIRED', 'uncertain'));
  assert.equal(f.calls.filter((args) => args[1] === 'invoke').length, 1);
});

test('offline pilot honors the existing shared desktop turn lock', async (t) => {
  const f = await fixture(t);
  const lock = path.join(f.root, 'desktop-input-turn.lock');
  await writeFile(lock, 'another desktop owner', { flag: 'wx' });
  await assert.rejects(desktopProbeAction(request, f.runner), typed('UI_TURN_BUSY', 'not-dispatched'));
  assert.equal(await readFile(lock, 'utf8'), 'another desktop owner');
  assert.equal(f.calls.length, 0);
});
