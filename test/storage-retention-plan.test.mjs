import assert from 'node:assert/strict';
import { test } from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {
  createRetentionPlan,
  revalidateRetentionPlan,
  verifyRetentionPayload,
} from '../scripts/storage-retention-plan.mjs';
import { canonicalPlanSha256 } from '../scripts/storage-retention-quarantine.mjs';

const A = 'a'.repeat(64),
  B = 'b'.repeat(64),
  C = 'c'.repeat(64),
  D = 'd'.repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
function fixture(kind = 'candidate') {
  const root = path.join(os.tmpdir(), 'workbridge-plan-fixture');
  const opRoot = path.join(root, '.local', 'update-operations', 'old');
  const releaseRoot = path.join(root, '.local', 'releases', 'old');
  const displacedId = '1'.repeat(32);
  const source = kind === 'candidate' ? path.join(opRoot, kind) : path.join(opRoot, kind, displacedId);
  const retainedRoot =
    kind === 'candidate' ? path.join(releaseRoot, 'payload') : path.join(opRoot, 'backup', 'runtime');
  const files = new Map();
  const add = (file, value, digest = A) => {
    const entry = {
      value,
      sha256: digest,
      identity: {
        dev: '1',
        ino: String(files.size + 1),
        size: '100',
        mtimeNs: '1',
        ctimeNs: '1',
        nlink: '1',
      },
    };
    files.set(file, entry);
    return { file, sha256: digest, identity: entry.identity };
  };
  const bindings = [
    add(path.join(opRoot, 'request.json'), {
      schema: 1,
      operationId: 'old',
      installRoot: root,
      releasePath: releaseRoot,
    }),
    add(path.join(opRoot, 'journal.json'), {
      schema: 1,
      operationId: 'old',
      installRoot: root,
      phase: 'completed',
    }),
  ];
  const manifestPath =
    kind === 'candidate'
      ? path.join(releaseRoot, 'manifest.json')
      : path.join(opRoot, 'backup-manifest.json');
  const manifestBinding = add(manifestPath, { schema: 1, files: [{ path: 'dist/a', bytes: 1, sha256: A }] });
  bindings.push(manifestBinding);
  if (kind === 'candidate')
    bindings.push(add(path.join(releaseRoot, 'validated.json'), { schema: 1, result: 'passed' }));
  const markerBinding = {
    path: path.join(root, '.local/installed-release.json'),
    sha256: B,
    identity: { ino: '99' },
  };
  const op = {
    id: 'old',
    phase: 'completed',
    updatedUtc: '2000-01-01T00:00:00Z',
    comparisonScopes: ['candidate', 'displaced'],
    protectedPaths: [opRoot],
    requestBinding: bindings[0],
    journalBinding: bindings[1],
    release: { scope: 'internal', path: releaseRoot, digest: A },
  };
  const graph = {
    schema: 1,
    installRoot: root,
    complete: true,
    mutationEligible: false,
    installed: {
      operationId: 'current',
      binding: markerBinding,
      sealBinding: {
        status: 'manifest-bound',
        manifestBinding: markerBinding,
        validatedBinding: markerBinding,
      },
    },
    operations: [op],
    references: [{ operationId: 'old', path: releaseRoot, scope: 'internal', digest: A }],
    protectedPaths: [opRoot, path.join(opRoot, 'backup'), releaseRoot],
    chain: { operationIds: ['current', 'previous'], complete: true, blockers: [] },
    blockers: [],
    bytesRead: 100,
    limits: { maxReadBytes: 999 },
  };
  const preview = {
    installRoot: root,
    complete: true,
    references: graph,
    issues: [],
    selection: {
      operationId: 'old',
      kind,
      resourceRoot: source,
      retainedRoot,
      manifestBinding,
      metadataBindings: bindings,
      manifestFileCount: 1,
    },
    comparison: { verifiedDuplicate: true, sourceTreeSha256: C, retainedTreeSha256: D, bytesHashed: 100 },
    elapsedMs: 1,
  };
  const identity = { volume: '0000000000000001', id: '00000000000000000000000000000002' };
  const deps = {
    previewRuntimeRetention: async () => clone(preview),
    inspectLocations: async () => ({ source: { exists: true, identity }, destination: { exists: false } }),
    now: () => Date.parse('2026-11-14T00:00:00Z'),
    loadBoundedJson: async (file) => {
      if (!files.has(file)) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return clone(files.get(file));
    },
    verifyRuntimeDuplicate: async () => clone(preview.comparison),
  };
  return {
    root,
    opRoot,
    releaseRoot,
    source,
    retainedRoot,
    op,
    preview,
    identity,
    files,
    deps,
    options: { installRoot: root, updaterOperationId: 'old', kind },
  };
}
test('closed old completed copies create exact canonical plans with native padded identities', async () => {
  for (const kind of ['candidate', 'displaced']) {
    const f = fixture(kind),
      plan = await createRetentionPlan(f.options, f.deps);
    assert.equal(plan.schema, 'workbridge-retention-plan/1', JSON.stringify(plan));
    assert.deepEqual(plan.sourceIdentity, f.identity);
    assert.equal(plan.manifestSha256, A);
    assert.equal(plan.sourceTreeSha256, C);
    assert.equal(plan.kind, kind);
    assert.match(canonicalPlanSha256(plan), /^[a-f0-9]{64}$/);
    assert.deepEqual(await revalidateRetentionPlan(plan, f.deps), plan);
  }
});
test('transient counts, elapsed times, limits and object key order do not stale a plan', async () => {
  const f = fixture(),
    plan = await createRetentionPlan(f.options, f.deps);
  f.preview.references.bytesRead = 999;
  f.preview.references.limits.maxReadBytes = 1;
  f.preview.elapsedMs = 500;
  f.preview.comparison.bytesHashed = 800;
  f.preview.selection.metadataBindings.reverse();
  assert.deepEqual(await revalidateRetentionPlan(plan, f.deps), plan);
});
test('incomplete graph, incomplete proof, unavailable active seal, and native identity refuse', async () => {
  for (const mutate of [
    (f) => {
      f.preview.references.complete = false;
    },
    (f) => {
      f.preview.references.chain.complete = false;
    },
    (f) => {
      f.preview.comparison.verifiedDuplicate = false;
    },
    (f) => {
      f.preview.references.installed.sealBinding = null;
    },
    (f) => {
      f.deps.inspectLocations = undefined;
    },
    (f) => {
      f.deps.inspectLocations = async () => ({ source: { exists: true, identity: { id: '1' } } });
    },
  ]) {
    const f = fixture();
    mutate(f);
    const result = await createRetentionPlan(f.options, f.deps);
    assert.equal(result.status, 'refused');
    assert.equal(result.mutationEligible, false);
  }
});
test('current and immediately previous updater generations remain protected', async () => {
  for (const id of ['current', 'previous']) {
    const f = fixture();
    f.preview.references.chain.operationIds[id === 'current' ? 0 : 1] = 'old';
    if (id === 'current') f.preview.references.installed.operationId = 'old';
    assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'PROTECTED_UPDATER_GENERATION');
  }
});
test('fixed fourteen-day threshold rejects recent, future, missing or invalid age metadata', async () => {
  for (const updatedUtc of [
    null,
    'invalid',
    '2026-11-13T00:00:00Z',
    '2027-01-01T00:00:00Z',
    '2026-02-30T00:00:00Z',
  ]) {
    const f = fixture();
    f.op.updatedUtc = updatedUtc;
    assert.equal((await createRetentionPlan(f.options, f.deps)).status, 'refused');
  }
  const f = fixture();
  f.op.updatedUtc = '2026-10-15T00:00:00Z';
  assert.equal((await createRetentionPlan(f.options, f.deps)).schema, 'workbridge-retention-plan/1');
});

test('fourteen full UTC days are required, with the exact boundary admitted', async () => {
  const f = fixture();
  const now = Date.parse('2026-11-14T00:00:00Z');
  f.deps.now = () => now;
  f.op.updatedUtc = '2026-10-31T00:00:01Z';
  assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'OPERATION_TOO_RECENT');
  f.op.updatedUtc = '2026-10-31T00:00:00Z';
  assert.equal((await createRetentionPlan(f.options, f.deps)).schema, 'workbridge-retention-plan/1');
});
test('release reference overlap in either direction and protected subtrees refuse', async () => {
  for (const alias of [(f) => f.source, (f) => path.join(f.source, 'nested-release'), (f) => f.opRoot]) {
    const f = fixture();
    f.preview.references.references[0].path = alias(f);
    assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'REFERENCED_RESOURCE');
  }
  const f = fixture();
  f.preview.references.protectedPaths.push(path.join(f.source, 'protected'));
  assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'PROTECTED_RESOURCE');
});
test('plan revalidation refuses changed source identity, metadata, reference graph, or file evidence', async () => {
  for (const mutate of [
    (f) => {
      f.identity.id = '3';
    },
    (f) => {
      f.preview.selection.metadataBindings[0].identity.ino = 'changed';
    },
    (f) => {
      f.preview.references.references.push({ path: path.join(f.root, 'unrelated'), scope: 'internal' });
    },
    (f) => {
      f.preview.comparison.sourceTreeSha256 = B;
    },
    (f) => {
      f.preview.comparison.retainedTreeSha256 = B;
    },
  ]) {
    const f = fixture(),
      plan = await createRetentionPlan(f.options, f.deps);
    mutate(f);
    await assert.rejects(revalidateRetentionPlan(plan, f.deps), { code: 'STALE_RETENTION_PLAN' });
  }
});
test('restoring archived payload verifies bound metadata and retained copy without requiring original source or graph', async () => {
  for (const kind of ['candidate', 'displaced']) {
    const f = fixture(kind),
      plan = await createRetentionPlan(f.options, f.deps);
    const archived = path.join(f.root, '.local', 'storage-quarantine', 'gc-old', 'payload');
    f.deps.previewRuntimeRetention = async () => {
      throw new Error('restore must not regenerate original source plan');
    };
    assert.equal(await verifyRetentionPayload(plan, archived, f.deps), true);
    f.preview.comparison.sourceTreeSha256 = B;
    assert.equal((await verifyRetentionPayload(plan, archived, f.deps)).verified, false);
  }
});
test('restore rejects stale metadata and out-of-scope locations', async () => {
  const f = fixture(),
    plan = await createRetentionPlan(f.options, f.deps);
  assert.equal(
    (await verifyRetentionPayload(plan, path.join(f.root, 'arbitrary'), f.deps)).code,
    'PAYLOAD_OUT_OF_SCOPE',
  );
  f.files.get(path.join(f.opRoot, 'request.json')).identity.ino = 'replaced';
  assert.equal((await verifyRetentionPayload(plan, f.source, f.deps)).code, 'METADATA_BINDING_MISMATCH');
});

test('host-mismatched plans refuse before any fresh filesystem or native inspection', async () => {
  const f = fixture(),
    plan = await createRetentionPlan(f.options, f.deps);
  plan.host = 'A-DIFFERENT-HOST';
  f.deps.previewRuntimeRetention = async () => {
    throw new Error('must not inspect another host plan');
  };
  f.deps.inspectLocations = async () => {
    throw new Error('must not inspect another host plan');
  };
  await assert.rejects(revalidateRetentionPlan(plan, f.deps), { code: 'IDENTITY_MISMATCH' });
});

test('known metadata refusals never request selected duplicate hashing', async () => {
  for (const mutate of [
    (f) => {
      f.preview.references.complete = false;
    },
    (f) => {
      f.op.updatedUtc = '2026-11-13T00:00:00Z';
    },
    (f) => {
      f.preview.references.installed.operationId = 'old';
    },
    (f) => {
      f.preview.references.chain.operationIds[1] = 'old';
    },
    (f) => {
      f.op.phase = 'preparing';
    },
  ]) {
    const f = fixture(),
      calls = [];
    mutate(f);
    f.deps.previewRuntimeRetention = async (options) => {
      calls.push(options);
      assert.equal(options.operationId, undefined, 'known refusal must not trigger duplicate hashing');
      return clone(f.preview);
    };
    assert.equal((await createRetentionPlan(f.options, f.deps)).status, 'refused');
    assert.deepEqual(calls, [{ installRoot: f.root }]);
  }
});
test('selected proof reacquires and checks policy after a passing cheap preflight', async () => {
  const f = fixture(),
    calls = [];
  f.deps.previewRuntimeRetention = async (options) => {
    calls.push(options);
    const fresh = clone(f.preview);
    if (options.operationId) fresh.references.complete = false;
    return fresh;
  };
  assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'REFERENCE_GRAPH_INCOMPLETE');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].operationId, undefined);
  assert.equal(calls[1].operationId, 'old');
});

test('any unresolved updater operation blocks planning before selected hashing; known terminal operations do not', async () => {
  for (const phase of ['preparing', 'prepared', 'installing', 'recovery_required', 'future-phase']) {
    const f = fixture(),
      calls = [];
    f.preview.references.operations.push({ id: 'other', phase });
    f.deps.previewRuntimeRetention = async (options) => {
      calls.push(options);
      assert.equal(options.operationId, undefined);
      return clone(f.preview);
    };
    assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'UNRESOLVED_UPDATER_OPERATION');
    assert.deepEqual(calls, [{ installRoot: f.root }]);
  }
  for (const phase of [
    'completed',
    'rolled_back',
    'failed_rolled_back',
    'preflight_failed',
    'controller_preflight_refused',
  ]) {
    const f = fixture();
    f.preview.references.operations.push({ id: 'other', phase });
    assert.equal((await createRetentionPlan(f.options, f.deps)).schema, 'workbridge-retention-plan/1');
  }
});

test('observed controller refusal cannot itself be selected for retention', async () => {
  const f = fixture();
  const op = f.preview.references.operations.find((row) => row.id === 'old');
  op.phase = 'controller_preflight_refused';
  op.comparisonScopes = [];
  assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'OPERATION_NOT_COMPARABLE');
});

test('a typed node-executable reference inside a selected copy blocks planning', async () => {
  const f = fixture();
  f.preview.references.references.push({
    operationId: 'other',
    kind: 'node-executable',
    path: path.join(f.source, 'node.exe'),
    scope: 'internal',
  });
  assert.equal((await createRetentionPlan(f.options, f.deps)).code, 'REFERENCED_RESOURCE');
});
