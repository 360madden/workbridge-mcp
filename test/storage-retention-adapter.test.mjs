import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { createMaintenanceAdapter, prepareOperation } from '../scripts/storage-retention-maintenance.mjs';

const ctx = {
  installRoot: path.resolve('fixture-root'),
  operationId: 'gc1',
  plan: { updaterOperationId: 'update1', kind: 'candidate' },
};
const ready =
  JSON.stringify({
    status: 'ready',
    sameVolume: true,
    source: { exists: true },
    destination: { exists: false },
  }) + '\n';
function fakeSpawn({ stuck = false, oversized = false, response = ready } = {}) {
  const calls = [];
  function launch(_exe, args) {
    calls.push(args);
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    let closed = false;
    const finish = () => {
      if (!closed) {
        closed = true;
        child.stdout.end();
        child.stderr.end();
        child.emit('close', 0);
      }
    };
    child.stdin.on('finish', () => {
      if (!stuck) finish();
    });
    child.kill = () => {
      if (!stuck) finish();
      return !stuck;
    };
    setImmediate(() => child.stdout.write(oversized ? Buffer.alloc(65537, 65) : response));
    return child;
  }
  return { calls, launch };
}
const testDeps = (spawn) => ({ spawn, closeWaitMs: 10, killWaitMs: 10 });

test('direct adapter and standalone preparation require literal maintenance confirmation before any IO', async () => {
  const fake = fakeSpawn();
  const adapter = createMaintenanceAdapter({
    maintenanceConfirmed: 'true',
    testDependencies: testDeps(fake.launch),
  });
  await assert.rejects(
    adapter.withMaintenance(ctx, async () => {}),
    { code: 'MAINTENANCE_REQUIRED' },
  );
  await assert.rejects(adapter.prepareOperation(ctx, {}), { code: 'MAINTENANCE_REQUIRED' });
  await assert.rejects(prepareOperation(ctx, {}), { code: 'MAINTENANCE_REQUIRED' });
  assert.equal(fake.calls.length, 0);
});

test('inspect works without confirmation and lease passes native affirmation', async () => {
  const fake = fakeSpawn();
  const deps = testDeps(fake.launch);
  const inspect = createMaintenanceAdapter({ testDependencies: deps });
  assert.equal((await inspect.inspectLocations(ctx)).sameVolume, true);
  assert.equal(fake.calls[0].includes('-MaintenanceConfirmed'), false);
  const lease = createMaintenanceAdapter({ maintenanceConfirmed: true, testDependencies: deps });
  assert.equal(await lease.withMaintenance(ctx, async () => 'ok'), 'ok');
  assert.equal(fake.calls[1].includes('-MaintenanceConfirmed'), true);
});

test('helper that will not exit even after kill refuses cleanup', async () => {
  const fake = fakeSpawn({ stuck: true });
  const adapter = createMaintenanceAdapter({
    maintenanceConfirmed: true,
    testDependencies: testDeps(fake.launch),
  });
  await assert.rejects(
    adapter.withMaintenance(ctx, async () => 'not success'),
    { code: 'MAINTENANCE_CLEANUP_UNVERIFIED' },
  );
});

test('oversized unterminated stdout is bounded and refused', async () => {
  const fake = fakeSpawn({ oversized: true });
  const adapter = createMaintenanceAdapter({ testDependencies: testDeps(fake.launch) });
  await assert.rejects(adapter.inspectLocations(ctx), { code: 'HELPER_OUTPUT_LIMIT' });
});

test('only Inventory mode accepts a bounded reply beyond the ordinary protocol limit', async () => {
  const identity = { volume: '1'.repeat(16), id: '1'.repeat(32) };
  const entries = [{ path: '', type: 'directory', identity, size: 0, nlink: 1, sha256: null }];
  for (let index = 0; index < 1000; index++)
    entries.push({
      path: `file-${index}.txt`,
      type: 'file',
      identity: { volume: identity.volume, id: (index + 2).toString(16).padStart(32, '0') },
      size: 0,
      nlink: 1,
      sha256: 'a'.repeat(64),
    });
  const response =
    JSON.stringify({
      status: 'ready',
      sameVolume: true,
      source: { exists: false },
      destination: { exists: true, identity },
      inventory: {
        schema: 'workbridge-retention-inventory/1',
        complete: true,
        nonAtomic: true,
        namedStreams: 0,
        totalBytes: 0,
        entries,
      },
    }) + '\n';
  assert.ok(Buffer.byteLength(response) > 65536);
  const fake = fakeSpawn({ response });
  const adapter = createMaintenanceAdapter({ testDependencies: testDeps(fake.launch) });
  assert.equal(
    (await adapter.inspectInventory({ ...ctx, plan: { ...ctx.plan, sourceIdentity: identity } })).entries
      .length,
    1001,
  );
  assert.ok(fake.calls[0].includes('Inventory'));
  assert.equal(fake.calls[0].includes('-MaintenanceConfirmed'), false);
  await assert.rejects(adapter.inspectLocations(ctx), { code: 'HELPER_OUTPUT_LIMIT' });
});
