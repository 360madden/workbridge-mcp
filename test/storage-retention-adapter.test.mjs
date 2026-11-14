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
function fakeSpawn({ stuck = false, oversized = false } = {}) {
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
    setImmediate(() => child.stdout.write(oversized ? Buffer.alloc(65537, 65) : ready));
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
