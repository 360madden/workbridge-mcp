import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseVmwareCaptureRequest } from '../scripts/vmware-host-capture.mjs';
import { inspectVmwareHostCaptureRecovery } from '../scripts/vmware-host-recovery.mjs';

const request = parseVmwareCaptureRequest([
  '--pid',
  '101',
  '--hwnd',
  '202',
  '--request-id',
  'recovery_fixture_01',
]);
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aP1sAAAAASUVORK5CYII=',
  'base64',
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(
  t,
  { completed = false, captured = true, original = 'minimized', current = original } = {},
) {
  const evidenceRoot = await mkdtemp(path.join(os.tmpdir(), 'workbridge-vm-recovery-'));
  t.after(async () => {
    const resolved = path.resolve(evidenceRoot);
    assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('workbridge-vm-recovery-'));
    await rm(resolved, { recursive: true, force: true });
  });
  const paths = {
    intent: path.join(evidenceRoot, `vm-host-capture-${request.requestId}.intent.json`),
    receipt: path.join(evidenceRoot, `vm-host-capture-${request.requestId}.json`),
    capture: path.join(evidenceRoot, `capture-${request.requestId}.json`),
    image: path.join(evidenceRoot, `capture-${request.requestId}.png`),
    lease: path.join(evidenceRoot, 'desktop-input-turn.lock'),
  };
  const intent = {
    schemaVersion: 1,
    requestId: request.requestId,
    vmx: request.vmx,
    pid: request.target.pid,
    hwnd: request.target.hwnd,
    expectedClass: request.expectedClass,
    originalWindowState: original,
    startedUtc: '2026-10-26T12:00:00.000Z',
  };
  const imageEvidence = {
    imagePath: paths.image,
    width: 1,
    height: 1,
    sizeBytes: PNG.length,
    sha256: digest(PNG),
  };
  const capture = {
    schemaVersion: 1,
    requestId: request.requestId,
    pid: request.target.pid,
    hwnd: request.target.hwnd,
    process: request.target.process,
    title: request.target.title,
    expectedClass: request.expectedClass,
    capturedUtc: '2026-10-26T12:00:01.000Z',
    ...imageEvidence,
    inputInjected: false,
    foregroundMayChange: true,
  };
  const receipt = {
    ...intent,
    completedUtc: '2026-10-26T12:00:02.000Z',
    ...imageEvidence,
    finalWindowState: original,
    stateRecovery: original === 'minimized' ? 'minimized' : 'not-needed',
    guestInputInjected: false,
    vmrunPasswordUsed: false,
  };
  const save = async (name, value) => writeFile(paths[name], JSON.stringify(value) + '\n');
  await save('intent', intent);
  if (captured) {
    await writeFile(paths.image, PNG);
    await save('capture', capture);
  }
  if (completed) await save('receipt', receipt);
  const calls = [];
  const state = { current, pid: 101, hwnd: 202, foreground: false, running: [request.vmx], version: '0.7.1' };
  const runner = async (args) => {
    calls.push(args);
    if (args[0] === '--version') return `winapp ${state.version}`;
    if (args[1] === 'list-windows') {
      return JSON.stringify([
        {
          hwnd: state.hwnd,
          processId: state.pid,
          processName: 'vmware',
          title: request.target.title,
          className: 'VMUIFrame',
          width: state.current === 'minimized' ? 160 : 1229,
          height: state.current === 'minimized' ? 28 : 885,
          isForeground: state.foreground,
        },
      ]);
    }
    if (args[1] === 'inspect') {
      return JSON.stringify({
        windows: [
          {
            hwnd: state.hwnd,
            elements: [
              {
                type: 'Window',
                className: 'VMUIFrame',
                x: state.current === 'minimized' ? -32000 : 55,
                y: state.current === 'minimized' ? -32000 : 45,
                width: state.current === 'minimized' ? 160 : 1229,
                height: state.current === 'minimized' ? 28 : 885,
                isOffscreen: state.current === 'minimized',
              },
            ],
          },
        ],
      });
    }
    assert.fail('Mutation or unexpected backend command: ' + args.join(' '));
  };
  const vmLister = async () => {
    calls.push(['vmrun', '-T', 'ws', 'list']);
    return state.running;
  };
  const inspect = (options = {}, target = request) =>
    inspectVmwareHostCaptureRecovery(target, {
      evidenceRoot,
      runner,
      vmLister,
      ...options,
    });
  const snapshot = async () => {
    const names = (await readdir(evidenceRoot)).sort();
    return await Promise.all(
      names.map(async (name) => [name, digest(await readFile(path.join(evidenceRoot, name)))]),
    );
  };
  return { evidenceRoot, paths, intent, capture, receipt, save, calls, state, runner, inspect, snapshot };
}

function onlyReads(calls) {
  assert.deepEqual(calls, [
    ['vmrun', '-T', 'ws', 'list'],
    ['--version'],
    ['ui', 'list-windows', '-a', '101', '--json'],
    ['ui', 'inspect', '-w', '202', '--depth', '2', '--json'],
  ]);
}

for (const original of ['minimized', 'visible']) {
  test(`completed ${original} capture verifies four file hashes without changing evidence`, async (t) => {
    const h = await fixture(t, { completed: true, original });
    const before = await h.snapshot();
    const result = await h.inspect();
    assert.equal(result.status, 'completed');
    assert.equal(result.ok, true);
    assert.equal(result.readOnly, true);
    assert.equal(result.automaticRetryAllowed, false);
    assert.equal(result.windowActionsPerformed, false);
    assert.equal(result.guestInputInjected, false);
    assert.equal(result.processStartIdentityVerified, false);
    assert.deepEqual(result.backend, { name: 'Microsoft.WinAppCli', version: '0.7.1' });
    assert.equal(result.evidence.length, 4);
    for (const item of result.evidence) {
      assert.equal(item.sha256, before.find(([name]) => name === item.name)[1]);
    }
    assert.deepEqual(await h.snapshot(), before);
    onlyReads(h.calls);
  });
}

test('interrupted aggregate receipt is recoverable but never synthesized or rerun', async (t) => {
  const h = await fixture(t);
  const before = await h.snapshot();
  for (let i = 0; i < 2; i++) {
    const result = await h.inspect();
    assert.equal(result.status, 'recoverable');
    assert.equal(result.automaticRetryAllowed, false);
    assert.equal(result.reason, 'VERIFIED_EVIDENCE_REQUIRES_EXPLICIT_RECONCILIATION');
    assert.deepEqual(await h.snapshot(), before);
  }
  onlyReads(h.calls.slice(0, 4));
  onlyReads(h.calls.slice(4));
});

for (const completed of [false, true]) {
  test(`changed window state requires review even with completed=${completed}`, async (t) => {
    const h = await fixture(t, { completed, current: 'visible' });
    const before = await h.snapshot();
    h.state.foreground = true;
    const result = await h.inspect();
    assert.equal(result.status, 'manual-review');
    assert.equal(result.reason, 'WINDOW_STATE_REQUIRES_REVIEW');
    assert.equal(result.currentWindowState, 'visible');
    assert.deepEqual(await h.snapshot(), before);
    onlyReads(h.calls);
  });
}

test('intent without a capture stays incomplete and is never automatically rerun', async (t) => {
  const h = await fixture(t, { captured: false });
  const before = await h.snapshot();
  const result = await h.inspect();
  assert.equal(result.status, 'manual-review');
  assert.equal(result.reason, 'CAPTURE_INCOMPLETE');
  assert.deepEqual(await h.snapshot(), before);
  onlyReads(h.calls);
});

test('empty evidence root returns missing intent without backend calls or writes', async (t) => {
  const h = await fixture(t, { captured: false });
  await rm(h.paths.intent);
  const result = await h.inspect();
  assert.equal(result.reason, 'CAPTURE_INTENT_MISSING');
  assert.equal(result.status, 'manual-review');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await readdir(h.evidenceRoot), []);
});

test('image without its receipt requires review without capture or overwrite', async (t) => {
  const h = await fixture(t);
  await rm(h.paths.capture);
  const before = await h.snapshot();
  const result = await h.inspect();
  assert.equal(result.status, 'manual-review');
  assert.equal(result.reason, 'IMAGE_RECEIPT_MISSING');
  assert.deepEqual(await h.snapshot(), before);
  onlyReads(h.calls);
});

test('shared lease is preserved and blocks even read-only backend probes', async (t) => {
  const h = await fixture(t);
  await writeFile(h.paths.lease, 'another owner');
  const before = await h.snapshot();
  const result = await h.inspect();
  assert.equal(result.status, 'manual-review');
  assert.equal(result.reason, 'DESKTOP_TURN_BUSY');
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await h.snapshot(), before);
});

for (const field of ['requestId', 'vmx', 'pid', 'hwnd', 'expectedClass', 'schemaVersion']) {
  test(`intent ${field} mismatch rejects before inventory or WinApp`, async (t) => {
    const h = await fixture(t);
    await h.save('intent', { ...h.intent, [field]: typeof h.intent[field] === 'number' ? 999 : 'wrong' });
    const before = await h.snapshot();
    const result = await h.inspect();
    assert.equal(result.status, 'unsafe-mismatch');
    assert.equal(result.reason, 'EVIDENCE_TARGET_MISMATCH');
    assert.deepEqual(h.calls, []);
    assert.deepEqual(await h.snapshot(), before);
  });
}

test('programmatic request cannot replace the pinned VMX or bypass target guards', async (t) => {
  const h = await fixture(t);
  for (const changed of [
    { ...request, vmx: 'C:\\different.vmx' },
    { ...request, requestId: '../escape' },
    { ...request, target: { ...request.target, process: 'other' } },
    { ...request, target: { ...request.target, pid: 0 } },
  ]) {
    assert.equal((await h.inspect({}, changed)).status, 'unsafe-mismatch');
  }
  assert.deepEqual(h.calls, []);
});

for (const field of ['pid', 'hwnd']) {
  test(`outdated ${field} fails fresh identity checks with no input`, async (t) => {
    const h = await fixture(t);
    h.state[field] = 999;
    const result = await h.inspect();
    assert.equal(result.status, 'unsafe-mismatch');
    assert.equal(result.reason, 'STALE_TARGET');
    assert.equal(h.calls.length, 3);
  });
}

test('wrong VM inventory rejects before WinApp', async (t) => {
  const h = await fixture(t);
  h.state.running = ['C:\\different.vmx'];
  const result = await h.inspect();
  assert.equal(result.status, 'unsafe-mismatch');
  assert.equal(result.reason, 'VM_NOT_RUNNING');
  assert.equal(h.calls.length, 1);
});

test('unsupported WinApp fails closed without listing or inspecting windows', async (t) => {
  const h = await fixture(t);
  h.state.version = '9.9.9';
  const result = await h.inspect();
  assert.equal(result.status, 'manual-review');
  assert.equal(result.reason, 'INSPECTION_UNAVAILABLE');
  assert.equal(h.calls.length, 2);
});

for (const [field, value] of [
  ['processName', 'different'],
  ['title', 'different'],
  ['className', 'different'],
]) {
  test(`fresh window ${field} mismatch fails closed`, async (t) => {
    const h = await fixture(t);
    const result = await h.inspect({
      runner: async (args) => {
        const output = await h.runner(args);
        if (args[1] !== 'list-windows') return output;
        const windows = JSON.parse(output);
        windows[0][field] = value;
        return JSON.stringify(windows);
      },
    });
    assert.equal(result.status, 'unsafe-mismatch');
    assert.equal(result.windowActionsPerformed, false);
  });
}

test('missing UIA dimensions cannot pass the existing capture geometry predicate', async (t) => {
  const h = await fixture(t, { original: 'visible' });
  const result = await h.inspect({
    runner: async (args) => {
      const output = await h.runner(args);
      if (args[1] !== 'inspect') return output;
      const tree = JSON.parse(output);
      delete tree.windows[0].elements[0].width;
      return JSON.stringify(tree);
    },
  });
  assert.equal(result.status, 'unsafe-mismatch');
  assert.equal(result.reason, 'INVALID_WINDOW_GEOMETRY');
});

test('invalid VM inventory is bounded and rejected before WinApp', async (t) => {
  const h = await fixture(t);
  for (const running of [null, [42], ['x'.repeat(4097)], Array(1001).fill(request.vmx)]) {
    h.state.running = running;
    assert.equal((await h.inspect()).reason, 'INVALID_VM_INVENTORY');
  }
  assert.equal(h.calls.length, 4);
  assert.ok(h.calls.every((args) => args[0] === 'vmrun'));
});

test('missing evidence directory is never created by inspection', async (t) => {
  const h = await fixture(t);
  const absent = path.join(h.evidenceRoot, 'absent');
  assert.equal((await h.inspect({ evidenceRoot: absent })).status, 'manual-review');
  assert.equal((await readdir(h.evidenceRoot)).includes('absent'), false);
  assert.deepEqual(h.calls, []);
});

for (const name of ['intent', 'receipt', 'capture']) {
  test(`malformed ${name} JSON never reaches a backend`, async (t) => {
    const h = await fixture(t, { completed: true });
    await writeFile(h.paths[name], '{invalid');
    const result = await h.inspect();
    assert.equal(result.status, 'unsafe-mismatch');
    assert.equal(result.reason, 'INVALID_EVIDENCE_JSON');
    assert.deepEqual(h.calls, []);
  });
}

test('oversized JSON is rejected without unbounded reads', async (t) => {
  const h = await fixture(t);
  await writeFile(h.paths.intent, ' '.repeat(65537));
  assert.equal((await h.inspect()).reason, 'EVIDENCE_BOUNDS');
  assert.deepEqual(h.calls, []);
});

test('oversized image is rejected before PNG parsing or backend calls', async (t) => {
  const h = await fixture(t);
  await writeFile(h.paths.image, Buffer.alloc(8 * 1024 * 1024 + 1));
  assert.equal((await h.inspect()).reason, 'EVIDENCE_BOUNDS');
  assert.deepEqual(h.calls, []);
});

test('tampered PNG hash is refused independently of the aggregate receipt', async (t) => {
  const h = await fixture(t, { completed: true });
  const changed = Buffer.from(PNG);
  changed[40] ^= 1;
  await writeFile(h.paths.image, changed);
  const before = await h.snapshot();
  const result = await h.inspect();
  assert.equal(result.status, 'unsafe-mismatch');
  assert.equal(result.reason, 'IMAGE_EVIDENCE_MISMATCH');
  assert.deepEqual(await h.snapshot(), before);
  assert.deepEqual(h.calls, []);
});

test('invalid PNG cannot be accepted merely because receipts match its hash', async (t) => {
  const h = await fixture(t);
  const bytes = Buffer.alloc(80, 5);
  await writeFile(h.paths.image, bytes);
  await h.save('capture', { ...h.capture, sha256: digest(bytes), sizeBytes: bytes.length });
  assert.equal((await h.inspect()).reason, 'INVALID_CAPTURE_PNG');
  assert.deepEqual(h.calls, []);
});

for (const [name, field, value] of [
  ['capture', 'hwnd', 999],
  ['capture', 'imagePath', path.resolve(os.tmpdir(), 'unrelated.png')],
  ['capture', 'width', 999],
  ['capture', 'sizeBytes', 999],
  ['capture', 'inputInjected', true],
  ['capture', 'capturedUtc', '2020-01-01T00:00:00Z'],
  ['receipt', 'sha256', 'a'.repeat(64)],
  ['receipt', 'originalWindowState', 'visible'],
  ['receipt', 'finalWindowState', 'visible'],
  ['receipt', 'startedUtc', '2020-01-01T00:00:00Z'],
  ['receipt', 'completedUtc', '2020-01-01T00:00:00Z'],
  ['receipt', 'stateRecovery', 'requires-review'],
  ['receipt', 'vmrunPasswordUsed', true],
]) {
  test(`${name}.${field} must match independently verified evidence`, async (t) => {
    const h = await fixture(t, { completed: true });
    await h.save(name, { ...h[name], [field]: value });
    assert.equal((await h.inspect()).status, 'unsafe-mismatch');
    assert.deepEqual(h.calls, []);
  });
}

test('aggregate receipt cannot certify missing capture evidence', async (t) => {
  const h = await fixture(t, { completed: true });
  await rm(h.paths.capture);
  assert.equal((await h.inspect()).reason, 'COMPLETED_EVIDENCE_MISSING');
  assert.deepEqual(h.calls, []);
});

test('orphan receipts cannot substitute for the original intent', async (t) => {
  const h = await fixture(t, { completed: true });
  await rm(h.paths.intent);
  assert.equal((await h.inspect()).reason, 'ORPHANED_CAPTURE_EVIDENCE');
  assert.deepEqual(h.calls, []);
});

test('evidence-root junction/symlink is rejected before reading files or probing', async (t) => {
  const h = await fixture(t);
  const target = path.join(h.evidenceRoot, 'actual');
  const shortcut = path.join(h.evidenceRoot, 'shortcut');
  await mkdir(target);
  await symlink(target, shortcut, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await h.inspect({ evidenceRoot: shortcut })).reason, 'EVIDENCE_LINK_REJECTED');
  assert.deepEqual(h.calls, []);
});

test('artifact junction is rejected without following it', async (t) => {
  const h = await fixture(t);
  await rm(h.paths.intent);
  const target = path.join(h.evidenceRoot, 'actual');
  await mkdir(target);
  await symlink(target, h.paths.intent, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await h.inspect()).reason, 'EVIDENCE_LINK_REJECTED');
  assert.deepEqual(h.calls, []);
});

test('artifact hard links are rejected without modifying their targets', async (t) => {
  const h = await fixture(t);
  const alias = path.join(h.evidenceRoot, 'intent-alias.json');
  await link(h.paths.intent, alias);
  assert.equal((await h.inspect()).reason, 'EVIDENCE_LINK_REJECTED');
  assert.equal(digest(await readFile(alias)), digest(await readFile(h.paths.intent)));
  assert.deepEqual(h.calls, []);
});

test('bounded WinApp output is enforced for injected runners too', async (t) => {
  const h = await fixture(t);
  const result = await h.inspect({ runner: async () => 'x'.repeat(384 * 1024 + 1) });
  assert.equal(result.status, 'unsafe-mismatch');
  assert.equal(result.reason, 'WINAPP_OUTPUT_BOUNDS');
});

test('backend diagnostics are not copied into recovery JSON', async (t) => {
  const h = await fixture(t);
  const result = await h.inspect({
    runner: async () => {
      throw new Error('private diagnostic');
    },
  });
  assert.equal(result.status, 'manual-review');
  assert.equal(JSON.stringify(result).includes('private diagnostic'), false);
  assert.ok(JSON.stringify(result).length < 4096);
});

test('concurrent evidence change during fresh inventory cannot be certified', async (t) => {
  const h = await fixture(t);
  const result = await h.inspect({
    vmLister: async () => {
      await h.save('intent', { ...h.intent, startedUtc: '2026-10-26T11:00:00.000Z' });
      return [request.vmx];
    },
  });
  assert.equal(result.status, 'unsafe-mismatch');
  assert.equal(result.reason, 'EVIDENCE_CHANGED');
});

test('a lease appearing during inspection remains untouched and prevents certification', async (t) => {
  const h = await fixture(t);
  const result = await h.inspect({
    vmLister: async () => {
      await writeFile(h.paths.lease, 'new owner');
      return [request.vmx];
    },
  });
  assert.equal(result.status, 'manual-review');
  assert.equal(result.reason, 'DESKTOP_TURN_BUSY');
  assert.equal(await readFile(h.paths.lease, 'utf8'), 'new owner');
});
