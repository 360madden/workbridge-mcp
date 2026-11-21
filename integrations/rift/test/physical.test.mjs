import assert from 'node:assert/strict';
import test from 'node:test';
import { physicalRiftIdentity, probeRiftWindows } from '../src/physical-epoch.mjs';
import { ResearchError } from '../src/identity.mjs';

const FILE_SHA = '1935a05c9db6d468e34e0055014a4a99c1b5afceb1695884e24600f5c20a4be8';
const EXE_PATH = 'C:\\Program Files (x86)\\Glyph\\Games\\RIFT\\Live\\rift_x64.exe';
const START_TICKS = '639301206978915233';

function processRecord(pid = 40452) {
  return {
    pid,
    processName: 'rift_x64',
    processStartUtcTicks: START_TICKS,
    startedUtc: '2026-11-13T01:32:08.2621379Z',
    sessionId: 1,
    executablePath: EXE_PATH,
    moduleName: 'rift_x64.exe',
    moduleBaseHex: '0x7FF700000000',
    moduleSizeBytes: 63164416,
  };
}

function windowRecord(pid = 40452, hwnd = 9246620) {
  return {
    processId: pid,
    processName: 'rift_x64',
    title: 'RIFT',
    className: 'TWNClientFramework',
    ownerHwnd: 0,
    hwnd,
    width: 1280,
    height: 720,
    isForeground: false,
  };
}

function controls({
  processes = [[processRecord()]],
  windows = [[windowRecord()]],
  image = null,
  host = 'AMD-DESKTOP',
} = {}) {
  let processCalls = 0;
  let windowCalls = 0;
  let imageCalls = 0;
  return {
    params: {
      expectedHost: 'AMD-DESKTOP',
      host,
      now: () => '2026-11-20T23:05:00.000Z',
      processProbe: async () => processes[Math.min(processCalls++, processes.length - 1)],
      windowsProbe: async () => ({ windows: windows[Math.min(windowCalls++, windows.length - 1)] }),
      imageProbe: async () => {
        imageCalls++;
        return (
          image ?? {
            path: EXE_PATH,
            sha256: FILE_SHA,
            bytes: 60493640,
            format: { kind: 'AMD64_PE32_PLUS' },
            identity: 'on_disk_image_only',
          }
        );
      },
    },
    calls: () => ({ processes: processCalls, windows: windowCalls, image: imageCalls }),
  };
}

test('exact single physical RIFT process/window is independently rechecked', async () => {
  const h = controls();
  const result = await physicalRiftIdentity(h.params);
  assert.equal(result.status, 'read_only_identity_observed');
  assert.equal(result.selected.pid, 40452);
  assert.equal(result.selected.processStartUtcTicks, START_TICKS);
  assert.equal(result.selected.window.hwnd, 9246620);
  assert.equal(result.selected.moduleBaseHex, '0x7FF700000000');
  assert.equal(result.selected.executableSha256, FILE_SHA);
  assert.equal(result.validation.processEpochRechecked, true);
  assert.equal(result.validation.hwndRechecked, true);
  assert.equal(result.validation.memoryLayoutQualified, false);
  assert.equal(result.inputSent, false);
  assert.equal(result.memoryRead, false);
  assert.deepEqual(h.calls(), { processes: 2, windows: 2, image: 1 });
});

test('wrong host cannot trigger process or window inspection', async () => {
  const h = controls({ host: 'LEGION' });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'WRONG_HOST',
  );
  assert.deepEqual(h.calls(), { processes: 0, windows: 0, image: 0 });
});

test('no physical RIFT process is a neutral observation, not a live-session claim', async () => {
  const h = controls({ processes: [[]] });
  const result = await physicalRiftIdentity(h.params);
  assert.equal(result.status, 'no_process_observed');
  assert.equal(result.selected, null);
  assert.equal(result.liveBindingVerified, false);
  assert.deepEqual(h.calls(), { processes: 1, windows: 0, image: 0 });
});

test('multibox inventory requires explicit exact PID and never silently chooses', async () => {
  const list = [processRecord(40452), processRecord(40453)];
  const h = controls({ processes: [list] });
  const summary = await physicalRiftIdentity(h.params);
  assert.equal(summary.status, 'explicit_pid_required');
  assert.deepEqual(
    summary.candidates.map((x) => x.pid),
    [40452, 40453],
  );
  assert.equal(summary.liveBindingVerified, false);
  assert.deepEqual(h.calls(), { processes: 1, windows: 0, image: 0 });
});

test('explicit multibox PID binds only the requested window', async () => {
  const p = [processRecord(40452), processRecord(40453)];
  const windows = [windowRecord(40452), windowRecord(40453, 9246621)];
  const h = controls({ processes: [p, p], windows: [windows, windows] });
  const result = await physicalRiftIdentity({ ...h.params, pid: 40453 });
  assert.equal(result.selected.pid, 40453);
  assert.equal(result.selected.window.hwnd, 9246621);
});

test('requesting a PID absent from the current process census fails', async () => {
  const h = controls();
  await assert.rejects(
    () => physicalRiftIdentity({ ...h.params, pid: 40453 }),
    (e) => e.code === 'TARGET_NOT_FOUND',
  );
  assert.deepEqual(h.calls(), { processes: 1, windows: 0, image: 0 });
});

test('PID reuse or changed process-start ticks after disk hashing refuses identity', async () => {
  const newer = { ...processRecord(), processStartUtcTicks: '639301206978915234' };
  const h = controls({ processes: [[processRecord()], [newer]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'PROCESS_EPOCH_CHANGED',
  );
});

test('module relocation or image path change during hashing refuses identity', async () => {
  const newer = { ...processRecord(), moduleBaseHex: '0x7FF800000000' };
  const h = controls({ processes: [[processRecord()], [newer]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'PROCESS_EPOCH_CHANGED',
  );
});

test('window handle changed between prehash and posthash observation refuses identity', async () => {
  const h = controls({ windows: [[windowRecord()], [windowRecord(40452, 9246622)]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'WINDOW_CHANGED',
  );
});

test('wrong Win32 class and title never qualify a RIFT window', async () => {
  const wrong = { ...windowRecord(), className: 'SomeOtherWindow' };
  const h = controls({ windows: [[wrong]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'WINDOW_NOT_FOUND',
  );
  assert.deepEqual(h.calls(), { processes: 1, windows: 1, image: 0 });
});

test('two candidate windows for one RIFT process are ambiguous', async () => {
  const h = controls({ windows: [[windowRecord(), windowRecord(40452, 9246622)]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'WINDOW_AMBIGUOUS',
  );
});

test('missing module identity fails without guessing a base address', async () => {
  const h = controls({ processes: [[{ ...processRecord(), error: 'PROCESS_DETAILS_UNAVAILABLE' }]] });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'PROCESS_IDENTITY_UNAVAILABLE',
  );
});

test('on-disk image path must match running process path, not a substitute', async () => {
  const h = controls({
    image: {
      path: 'C:\\somewhere\\rift_x64.exe',
      sha256: FILE_SHA,
      bytes: 60493640,
      format: { kind: 'AMD64_PE32_PLUS' },
      identity: 'on_disk_image_only',
    },
  });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'CLIENT_IMAGE_MISMATCH',
  );
});

test('invalid or rounded ticks cannot become exact process epoch evidence', async () => {
  const h = controls({
    processes: [
      [
        {
          ...processRecord(),
          processStartUtcTicks: Number(START_TICKS),
        },
      ],
    ],
  });
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'PROCESS_IDENTITY_INVALID',
  );
});

test('incomplete process census cannot claim target absence', async () => {
  const h = controls();
  h.params.processProbe = async () => {
    throw new ResearchError('PROCESS_CENSUS_UNAVAILABLE', 'probe failed');
  };
  await assert.rejects(
    () => physicalRiftIdentity(h.params),
    (e) => e.code === 'PROCESS_CENSUS_UNAVAILABLE',
  );
});

test('WinApp collector reuses versioned read-only windows operation', async () => {
  const calls = [];
  const r = await probeRiftWindows(async (args) => {
    calls.push(args);
    return calls.length === 1 ? 'Microsoft WinApp CLI 0.7.1' : JSON.stringify({ windows: [windowRecord()] });
  });
  assert.equal(r.windows.length, 1);
  assert.deepEqual(calls, [['--version'], ['ui', 'list-windows', '-a', 'rift', '--json']]);
});

test('unsupported WinApp version refuses without enumerating windows', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      probeRiftWindows(async (args) => {
        calls.push(args);
        return 'Microsoft WinApp CLI 0.7.2';
      }),
    (e) => e.code === 'WINAPP_VERSION',
  );
  assert.deepEqual(calls, [['--version']]);
});
