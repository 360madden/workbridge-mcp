import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Isolated source-compilation tests must never rewrite the active Workbridge dist directory.
const { composeDesktopScreenshot, registerDesktopTools, withDesktopCaptureTurn } = await import(
  process.env.WB_DESKTOP_REGISTRATION_TEST_MODULE ?? '../dist/desktop-registration.js'
);

function registrations() {
  const tools = new Map();
  registerDesktopTools({
    registerTool(name, options, callback) {
      assert.equal(tools.has(name), false, 'duplicate desktop tool');
      tools.set(name, { options, callback });
    },
  });
  return tools;
}

test('GUI-006 exposes four scoped desktop/VM tools with truthful annotations', () => {
  const tools = registrations();
  assert.deepEqual(
    [...tools.keys()],
    ['desktop_windows', 'desktop_inspect', 'desktop_capture_window', 'desktop_capture_vmware_host'],
  );
  for (const [name, record] of tools) {
    assert.equal(record.options.annotations.destructiveHint, false, name);
    assert.equal(record.options.annotations.idempotentHint, true, name);
    assert.equal(record.options.annotations.openWorldHint, false, name);
    assert.equal(typeof record.options.description, 'string');
    assert.ok(record.options.description.length > 35);
  }
  assert.equal(tools.get('desktop_windows').options.annotations.readOnlyHint, true);
  assert.equal(tools.get('desktop_inspect').options.annotations.readOnlyHint, true);
  assert.equal(tools.get('desktop_capture_window').options.annotations.readOnlyHint, false);
  assert.equal(tools.get('desktop_capture_vmware_host').options.annotations.readOnlyHint, false);
});

test('GUI-006 exact target schemas reject unbounded or anonymous desktop access', () => {
  const tools = registrations();
  const check = (name, value) => tools.get(name).options.inputSchema.safeParse(value).success;
  assert.equal(check('desktop_windows', {}), true);
  assert.equal(check('desktop_windows', { app: 'vmware' }), true);
  assert.equal(check('desktop_windows', { app: 'x'.repeat(101) }), false);
  const target = { pid: 240, hwnd: 123456, process: 'explorer' };
  assert.equal(check('desktop_inspect', target), true);
  assert.equal(check('desktop_inspect', { pid: 240, hwnd: 123456 }), false);
  assert.equal(check('desktop_inspect', { ...target, depth: 5 }), false);
  assert.equal(check('desktop_inspect', { ...target, title: 'x'.repeat(201) }), false);
  assert.equal(check('desktop_inspect', { ...target, pid: 0 }), false);
  assert.equal(check('desktop_capture_window', { ...target, requestId: 'gui006_test_0001' }), true);
  assert.equal(check('desktop_capture_window', { ...target, requestId: 'x' }), false);
  assert.equal(check('desktop_capture_window', { ...target, requestId: '../file' }), false);
  assert.equal(
    check('desktop_capture_vmware_host', { pid: 240, hwnd: 123456, requestId: 'gui006_vm_0001' }),
    true,
  );
  assert.equal(
    check('desktop_capture_vmware_host', { pid: 240, hwnd: 0, requestId: 'gui006_vm_0001' }),
    false,
  );
});

test('GUI-006 emits image content only after a separate verified read and omits base64 from metadata', async () => {
  const receipt = {
    ok: true,
    requestId: 'gui006_image_001',
    imagePath: 'C:\\opaque\\capture-gui006_image_001.png',
    sha256: 'a'.repeat(64),
    sizeBytes: 65,
    width: 1,
    height: 1,
    inputInjected: false,
  };
  const data = Buffer.from('verified synthetic bytes').toString('base64');
  let invocations = 0;
  const result = await composeDesktopScreenshot(receipt, async (given) => {
    invocations++;
    assert.equal(given, receipt);
    return {
      mimeType: 'image/png',
      data,
      sha256: receipt.sha256,
      sizeBytes: receipt.sizeBytes,
      width: receipt.width,
      height: receipt.height,
      requestId: receipt.requestId,
    };
  });
  assert.equal(invocations, 1);
  assert.deepEqual(result.content[1], { type: 'image', mimeType: 'image/png', data });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(result.structuredContent.imageBytesVerified, receipt.sizeBytes);
  assert.equal(result.structuredContent.imageSha256Verified, receipt.sha256);
  assert.equal(result.structuredContent.imagePath, receipt.imagePath);
  assert.equal(JSON.stringify(result.structuredContent).includes(data), false);
});

test('GUI-006 shared capture turn serializes callers and preserves a foreign lock', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wb-gui006-turn-'));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const lock = path.join(base, 'desktop-input-turn.lock');
  const owner = { requestId: 'gui006_lock_001', pid: 240, hwnd: 123456, process: 'explorer' };
  let secondRan = false;
  const answer = await withDesktopCaptureTurn(
    async () => {
      const exists = await stat(lock);
      assert.equal(exists.isFile(), true);
      const stamp = JSON.parse(await readFile(lock, 'utf8'));
      assert.equal(stamp.kind, 'workbridge.gui-turn');
      assert.equal(stamp.producer, 'desktop-capture-window');
      assert.equal(stamp.requestId, owner.requestId);
      assert.equal(stamp.target.pid, owner.pid);
      assert.equal(stamp.target.hwnd, owner.hwnd);
      assert.match(stamp.leaseId, /^[0-9a-f-]{36}$/);
      assert.equal(stamp.owner.pid, process.pid);
      await assert.rejects(
        withDesktopCaptureTurn(async () => {
          secondRan = true;
        }, lock),
        { code: 'UI_TURN_BUSY' },
      );
      assert.equal(secondRan, false);
      return 'complete';
    },
    lock,
    owner,
  );
  assert.equal(answer, 'complete');
  await assert.rejects(stat(lock), { code: 'ENOENT' });
  await assert.rejects(
    withDesktopCaptureTurn(async () => {
      throw new Error('test-failure');
    }, lock),
    /test-failure/,
  );
  await assert.rejects(stat(lock), { code: 'ENOENT' });
  await writeFile(lock, 'foreign-owner', { flag: 'wx' });
  await assert.rejects(
    withDesktopCaptureTurn(async () => {}, lock),
    { code: 'UI_TURN_BUSY' },
  );
  assert.equal(await readFile(lock, 'utf8'), 'foreign-owner');
});

test('GUI-006 refuses to release an ownership stamp changed by another writer', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wb-gui006-modified-owner-'));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const lock = path.join(base, 'desktop-input-turn.lock');
  await assert.rejects(
    withDesktopCaptureTurn(async () => {
      await writeFile(lock, 'foreign-owner');
      return 'action-finished';
    }, lock),
    { code: 'UI_TURN_RECOVERY_REQUIRED' },
  );
  assert.equal(await readFile(lock, 'utf8'), 'foreign-owner');
});

test('GUI-006 quarantines the shared GUI turn when a descendant is not confirmed stopped', async (t) => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'wb-gui006-uncertain-turn-'));
  t.after(async () => rm(base, { recursive: true, force: true }));
  const lock = path.join(base, 'desktop-input-turn.lock');
  const unsettled = Object.assign(new Error('process tree settlement not verified'), {
    code: 'DESKTOP_TREE_UNSETTLED',
  });
  await assert.rejects(
    withDesktopCaptureTurn(async () => {
      throw unsettled;
    }, lock),
    { code: 'DESKTOP_TREE_UNSETTLED' },
  );
  assert.equal((await stat(lock)).isFile(), true, 'uncertain turn remains quarantined');
  const stampBytes = await readFile(lock);
  const stamp = JSON.parse(stampBytes.toString('utf8'));
  const quarantine = JSON.parse(
    await readFile(path.join(base, 'desktop-turn-quarantine-' + stamp.leaseId + '.json'), 'utf8'),
  );
  assert.equal(quarantine.kind, 'workbridge.gui-turn-quarantine');
  assert.equal(quarantine.leaseId, stamp.leaseId);
  assert.equal(quarantine.ownerStampSha256, createHash('sha256').update(stampBytes).digest('hex'));
  assert.equal(quarantine.processTreeSettlement, 'unknown');
  assert.equal(quarantine.automaticRetryAllowed, false);
  let secondRan = false;
  await assert.rejects(
    withDesktopCaptureTurn(async () => {
      secondRan = true;
    }, lock),
    { code: 'UI_TURN_BUSY' },
  );
  assert.equal(secondRan, false, 'a second caller cannot enter an uncertain turn');
});

test('GUI-006 capture callbacks fail closed for invalid requests without launching WinApp/VMware', async () => {
  const tools = registrations();
  const desktop = tools.get('desktop_capture_window');
  const vmware = tools.get('desktop_capture_vmware_host');
  const inspect = tools.get('desktop_inspect');
  // Direct callback invocation intentionally bypasses MCP input validation here.
  // The adapters must still reject bad identities before spawning a process.
  const tasks = [
    desktop.callback({ pid: 0, hwnd: 22, process: 'explorer', requestId: 'gui006_bad_001' }),
    vmware.callback({ pid: 0, hwnd: 22, requestId: 'gui006_bad_002' }),
    inspect.callback({ pid: 0, hwnd: 22, process: 'explorer' }),
  ];
  const results = await Promise.all(tasks);
  for (const result of results) {
    assert.equal(result.isError, true);
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    assert.ok(JSON.parse(result.content[0].text).error);
    assert.equal(result.structuredContent, undefined);
  }
});
