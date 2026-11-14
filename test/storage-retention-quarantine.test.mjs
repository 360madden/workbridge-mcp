import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  lstat,
  rename,
  open,
  link,
  symlink,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  quarantine,
  retentionStatus,
  restore,
  canonicalPlanSha256,
} from '../scripts/storage-retention-quarantine.mjs';

// This guard is deliberately a single-process, disposable fixture adapter.
// It tests the journal state machine, not Windows atomic no-replace or lock semantics.
const identity = (stat) => ({ volume: String(stat.dev), id: String(stat.ino) });
async function observed(file) {
  try {
    return { exists: true, identity: identity(await lstat(file, { bigint: true })) };
  } catch (error) {
    if (error.code === 'ENOENT') return { exists: false };
    throw error;
  }
}
async function fixture(t, kind = 'candidate') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-retention-m3-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const updaterOperationId = 'fixture-update';
  const operationId = 'fixture-quarantine';
  const displacedId = kind === 'displaced' ? 'a'.repeat(32) : null;
  const source =
    kind === 'candidate'
      ? path.join(root, '.local', 'update-operations', updaterOperationId, 'candidate')
      : path.join(root, '.local', 'update-operations', updaterOperationId, 'displaced', displacedId);
  const destination = path.join(root, '.local', 'storage-quarantine', operationId, 'payload');
  await mkdir(source, { recursive: true });
  await mkdir(path.join(root, '.local', 'storage-quarantine'), { recursive: true });
  await writeFile(path.join(source, 'sentinel'), 'preserve the original bytes');
  const sourceIdentity = identity(await lstat(source, { bigint: true }));
  const plan = {
    schema: 'workbridge-retention-plan/1',
    host: os.hostname(),
    installRoot: root,
    updaterOperationId,
    kind,
    displacedId,
    sourceIdentity,
    manifestSha256: 'a'.repeat(64),
    retainedBindingSha256: 'b'.repeat(64),
    metadataSha256: 'c'.repeat(64),
    referencesSha256: 'd'.repeat(64),
    sourceTreeSha256: 'e'.repeat(64),
  };
  const expectedPlanSha256 = canonicalPlanSha256(plan);
  const request = { installRoot: root, operationId, plan, expectedPlanSha256, maintenanceConfirmed: true };
  const inspectLocations = async () => ({
    sameVolume: true,
    source: await observed(source),
    destination: await observed(destination),
  });
  const sameIdentity = (a, b) => a?.volume === b?.volume && a?.id === b?.id;
  const deps = {
    revalidatePlan: async () => structuredClone(plan),
    prepareOperation: async (context, intent) => {
      try {
        await mkdir(context.operationDir);
        const handle = await open(path.join(context.operationDir, 'intent.json'), 'wx');
        try {
          await handle.writeFile(JSON.stringify(intent));
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
    },
    inspectLocations,
    withMaintenance: async (context, callback) => {
      assert.equal(context.source, source);
      assert.equal(context.destination, destination);
      return callback({
        inspect: inspectLocations,
        verifyPayload: async () => true,
        // Disposable-fixture publication only; this is not a Windows atomicity claim.
        publishPhase: async ({ phase, planSha256 }) => {
          const scratch = path.join(context.operationDir, `fixture-${randomUUID()}.tmp`);
          const final = path.join(context.operationDir, `${phase}.json`);
          const handle = await open(scratch, 'wx');
          try {
            await handle.writeFile(
              JSON.stringify({ schema: 'workbridge-retention-phase/1', operationId, planSha256, phase }),
            );
            await handle.sync();
          } finally {
            await handle.close();
          }
          try {
            await link(scratch, final);
          } finally {
            await rm(scratch, { force: true });
          }
        },
        moveNoReplace: async ({ from, expectedIdentity }) => {
          const origin = from === 'source' ? source : destination;
          const target = from === 'source' ? destination : source;
          const current = await observed(origin);
          if (!current.exists || !sameIdentity(current.identity, expectedIdentity))
            throw new Error('IDENTITY_CHANGED');
          if ((await observed(target)).exists) throw new Error('DESTINATION_EXISTS');
          await mkdir(path.dirname(target), { recursive: true });
          await rename(origin, target);
        },
      });
    },
  };
  const statusArgs = { installRoot: root, operationId };
  const restoreArgs = { ...statusArgs, expectedPlanSha256, maintenanceConfirmed: true };
  return {
    root,
    source,
    destination,
    sourceIdentity,
    plan,
    request,
    statusArgs,
    restoreArgs,
    deps,
    inspectLocations,
  };
}

for (const kind of ['candidate', 'displaced']) {
  test(`${kind} quarantine and restore preserve original tree and directory identity`, async (t) => {
    const f = await fixture(t, kind);
    const moved = await quarantine(f.request, f.deps);
    assert.equal(moved.state, 'quarantined');
    assert.equal((await observed(f.source)).exists, false);
    assert.deepEqual((await observed(f.destination)).identity, f.sourceIdentity);
    assert.equal(await readFile(path.join(f.destination, 'sentinel'), 'utf8'), 'preserve the original bytes');
    const restored = await restore(f.restoreArgs, f.deps);
    assert.equal(restored.state, 'restored');
    assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
    assert.equal((await observed(f.destination)).exists, false);
  });
}

test('stale proof or changed metadata refuses before movement', async (t) => {
  const f = await fixture(t);
  const deps = { ...f.deps, revalidatePlan: async () => ({ ...f.plan, metadataSha256: 'f'.repeat(64) }) };
  await assert.rejects(quarantine(f.request, deps));
  assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
  assert.equal((await observed(f.destination)).exists, false);
});

test('maintenance admission conflict leaves source untouched', async (t) => {
  const f = await fixture(t);
  const deps = {
    ...f.deps,
    withMaintenance: async () => {
      throw new Error('UPDATER_LOCK_BUSY');
    },
  };
  await assert.rejects(quarantine(f.request, deps), /UPDATER_LOCK_BUSY/);
  assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
  assert.equal((await observed(f.destination)).exists, false);
});

for (const phase of ['after-intent-before-rename', 'after-rename-before-commit']) {
  test(`quarantine interruption ${phase} is observable and retry does not duplicate`, async (t) => {
    const f = await fixture(t);
    const interrupted = {
      ...f.deps,
      fault: async (point) => {
        if (point === phase) throw new Error('SIMULATED_CRASH');
      },
    };
    await assert.rejects(quarantine(f.request, interrupted), /SIMULATED_CRASH/);
    const before = await f.inspectLocations();
    assert.notEqual(before.source.exists, before.destination.exists);
    const snapshot = await retentionStatus(f.statusArgs, f.deps);
    assert.notEqual(snapshot.state, 'conflict');
    const afterStatus = await f.inspectLocations();
    assert.deepEqual(afterStatus, before);
    const retried = await quarantine(f.request, f.deps);
    assert.equal(retried.state, 'quarantined');
    assert.deepEqual((await observed(f.destination)).identity, f.sourceIdentity);
  });
}

for (const phase of ['after-restore-intent-before-rename', 'after-restore-rename-before-commit']) {
  test(`restore interruption ${phase} reconciles without replacing data`, async (t) => {
    const f = await fixture(t);
    await quarantine(f.request, f.deps);
    const interrupted = {
      ...f.deps,
      fault: async (point) => {
        if (point === phase) throw new Error('SIMULATED_CRASH');
      },
    };
    await assert.rejects(restore(f.restoreArgs, interrupted), /SIMULATED_CRASH/);
    const before = await f.inspectLocations();
    assert.notEqual(before.source.exists, before.destination.exists);
    const snapshot = await retentionStatus(f.statusArgs, f.deps);
    assert.notEqual(snapshot.state, 'conflict');
    assert.deepEqual(await f.inspectLocations(), before);
    const retried = await restore(f.restoreArgs, f.deps);
    assert.equal(retried.state, 'restored');
    assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
  });
}

test('both present is conflict and restore never overwrites the replacement', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  await mkdir(f.source, { recursive: true });
  await writeFile(path.join(f.source, 'sentinel'), 'new replacement');
  const status = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(status.state, 'conflict');
  await assert.rejects(restore(f.restoreArgs, f.deps));
  assert.equal(await readFile(path.join(f.source, 'sentinel'), 'utf8'), 'new replacement');
  assert.equal(await readFile(path.join(f.destination, 'sentinel'), 'utf8'), 'preserve the original bytes');
});

test('neither present is conflict and does not fabricate a restored state', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  await rm(f.destination, { recursive: true });
  const status = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(status.state, 'conflict');
  await assert.rejects(restore(f.restoreArgs, f.deps));
});

test('same operation ID with a different plan never overwrites journal or payload', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  const alteredPlan = { ...f.plan, sourceTreeSha256: 'f'.repeat(64) };
  await assert.rejects(
    quarantine(
      { ...f.request, plan: alteredPlan, expectedPlanSha256: canonicalPlanSha256(alteredPlan) },
      f.deps,
    ),
  );
  assert.equal(await readFile(path.join(f.destination, 'sentinel'), 'utf8'), 'preserve the original bytes');
});

test('missing maintenance or mismatched hash cannot initiate filesystem mutation', async (t) => {
  const f = await fixture(t);
  await assert.rejects(quarantine(f.request), /SAFE_MAINTENANCE_UNAVAILABLE/);
  await assert.rejects(
    quarantine({ ...f.request, expectedPlanSha256: 'f'.repeat(64) }, f.deps),
    /PLAN_HASH_MISMATCH/,
  );
  await assert.rejects(
    quarantine({ ...f.request, maintenanceConfirmed: false }, f.deps),
    /MAINTENANCE_REQUIRED/,
  );
  assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
  assert.equal((await observed(f.destination)).exists, false);
});

test('destination collision immediately before rename never overwrites replacement', async (t) => {
  const f = await fixture(t);
  const deps = {
    ...f.deps,
    fault: async (point) => {
      if (point === 'after-intent-before-rename') {
        await mkdir(f.destination);
        await writeFile(path.join(f.destination, 'sentinel'), 'concurrent replacement');
      }
    },
  };
  await assert.rejects(quarantine(f.request, deps), /DESTINATION_EXISTS/);
  assert.equal(await readFile(path.join(f.source, 'sentinel'), 'utf8'), 'preserve the original bytes');
  assert.equal(await readFile(path.join(f.destination, 'sentinel'), 'utf8'), 'concurrent replacement');
  assert.equal((await retentionStatus(f.statusArgs, f.deps)).state, 'conflict');
});

test('partial operation directory without immutable intent is never reused', async (t) => {
  const f = await fixture(t);
  await mkdir(path.dirname(f.destination));
  await assert.rejects(quarantine(f.request, f.deps));
  assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
  assert.equal((await observed(f.destination)).exists, false);
});

test('linked journal phases and junction operation directories are refused', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  const opDir = path.dirname(f.destination);
  const marker = path.join(opDir, 'quarantined.json');
  await link(marker, path.join(f.root, 'marker-alias.json'));
  await assert.rejects(retentionStatus(f.statusArgs, f.deps), /LINKED_REFERENCE_FILE/);
  await assert.rejects(restore(f.restoreArgs, f.deps), /LINKED_REFERENCE_FILE/);
  assert.equal(await readFile(path.join(f.destination, 'sentinel'), 'utf8'), 'preserve the original bytes');
});

test('junction to operation directory is refused before status or restore', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  const opDir = path.dirname(f.destination);
  const relocated = path.join(f.root, 'relocated-journal');
  await rename(opDir, relocated);
  await symlink(relocated, opDir, 'junction');
  await assert.rejects(retentionStatus(f.statusArgs, f.deps));
  await assert.rejects(restore(f.restoreArgs, f.deps));
  assert.equal(
    await readFile(path.join(relocated, 'payload', 'sentinel'), 'utf8'),
    'preserve the original bytes',
  );
});

test('existing null phase is corruption, not missing phase', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    quarantine(f.request, {
      ...f.deps,
      fault: async () => {
        throw new Error('INTERRUPTED');
      },
    }),
  );
  await writeFile(path.join(path.dirname(f.destination), 'quarantined.json'), 'null');
  await assert.rejects(retentionStatus(f.statusArgs, f.deps), /INVALID_JOURNAL/);
});

test('lost lease after destination verification cannot publish quarantine completion', async (t) => {
  const f = await fixture(t);
  const deps = {
    ...f.deps,
    withMaintenance: (ctx, callback) =>
      f.deps.withMaintenance(ctx, (guard) => {
        let lost = false;
        return callback({
          ...guard,
          inspect: async () => {
            if (lost) throw new Error('LEASE_EXPIRED');
            return guard.inspect();
          },
          verifyPayload: async (where, plan) => {
            const ok = await guard.verifyPayload(where, plan);
            if (where === 'destination') lost = true;
            return ok;
          },
        });
      }),
  };
  await assert.rejects(quarantine(f.request, deps), /LEASE_EXPIRED/);
  const state = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(state.state, 'quarantined');
  assert.equal(state.pendingCommit, true);
});

test('lost lease after restored payload verification cannot publish restore completion', async (t) => {
  const f = await fixture(t);
  await quarantine(f.request, f.deps);
  const deps = {
    ...f.deps,
    withMaintenance: (ctx, callback) =>
      f.deps.withMaintenance(ctx, (guard) => {
        let lost = false;
        return callback({
          ...guard,
          inspect: async () => {
            if (lost) throw new Error('LEASE_EXPIRED');
            return guard.inspect();
          },
          verifyPayload: async (where, plan) => {
            const ok = await guard.verifyPayload(where, plan);
            if (where === 'source') lost = true;
            return ok;
          },
        });
      }),
  };
  await assert.rejects(restore(f.restoreArgs, deps), /LEASE_EXPIRED/);
  const state = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(state.state, 'restoring');
  assert.equal(state.pendingCommit, true);
});

test('missing or invalid publisher capability refuses before any payload move', async (t) => {
  const f = await fixture(t);
  for (const publisher of [undefined, null, 'unsafe']) {
    const deps = {
      ...f.deps,
      withMaintenance: (ctx, callback) =>
        f.deps.withMaintenance(ctx, (guard) => callback({ ...guard, publishPhase: publisher })),
    };
    await assert.rejects(quarantine(f.request, deps), /SAFE_MAINTENANCE_UNAVAILABLE/);
    assert.deepEqual((await observed(f.source)).identity, f.sourceIdentity);
    assert.equal((await observed(f.destination)).exists, false);
  }
});

test('publisher reporting success without marker cannot fabricate completion', async (t) => {
  const f = await fixture(t);
  const deps = {
    ...f.deps,
    withMaintenance: (ctx, callback) =>
      f.deps.withMaintenance(ctx, (guard) => callback({ ...guard, publishPhase: async () => {} })),
  };
  await assert.rejects(quarantine(f.request, deps), /INVALID_JOURNAL/);
  const status = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(status.state, 'quarantined');
  assert.equal(status.pendingCommit, true);
});

test('stale scratch is never treated as a phase or a blocker to validated replay', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    quarantine(f.request, {
      ...f.deps,
      fault: async (phase) => {
        if (phase === 'after-rename-before-commit') throw new Error('SIMULATED_CRASH');
      },
    }),
    /SIMULATED_CRASH/,
  );
  await writeFile(path.join(path.dirname(f.destination), 'stale-phase.tmp'), '{');
  const status = await retentionStatus(f.statusArgs, f.deps);
  assert.equal(status.state, 'quarantined');
  assert.equal(status.pendingCommit, true);
  assert.equal((await quarantine(f.request, f.deps)).state, 'quarantined');
});

test('timestamped v2 phases support quarantine, status and restore', async (t) => {
  const f = await fixture(t);
  const deps = {
    ...f.deps,
    withMaintenance: (ctx, callback) =>
      f.deps.withMaintenance(ctx, (guard) =>
        callback({
          ...guard,
          publishPhase: async ({ phase, planSha256 }) => {
            const scratch = path.join(ctx.operationDir, `v2-${randomUUID()}.tmp`);
            const handle = await open(scratch, 'wx');
            try {
              await handle.writeFile(
                JSON.stringify({
                  schema: 'workbridge-retention-phase/2',
                  operationId: ctx.operationId,
                  planSha256,
                  phase,
                  publishedAtUtc: new Date().toISOString(),
                }),
              );
              await handle.sync();
            } finally {
              await handle.close();
            }
            try {
              await link(scratch, path.join(ctx.operationDir, `${phase}.json`));
            } finally {
              await rm(scratch, { force: true });
            }
          },
        }),
      ),
  };
  assert.equal((await quarantine(f.request, deps)).state, 'quarantined');
  assert.equal((await retentionStatus(f.statusArgs, deps)).state, 'quarantined');
  assert.equal((await restore(f.restoreArgs, deps)).state, 'restored');
  assert.equal((await retentionStatus(f.statusArgs, deps)).state, 'restored');
});
