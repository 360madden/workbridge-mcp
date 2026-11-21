import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { createStarWrathProvider, summarizeStarSnapshot } from '../src/adapters/starwrath.mjs';
import { validatePlan } from '../src/plan.mjs';
import { runResearch, verifyResearchRun } from '../src/run.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HOST = 'AMD-DESKTOP';
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const scriptFiles = {
  comparator: 'compare_physics_runs.py',
  physicsInspector: 'inspect_physics_params.py',
  indexInspector: 'inspect_tgp2_index.py',
  gamedataInspector: 'inspect_gamedata.py',
};

async function fixture(t, { mismatched = false, incomplete = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'wb-starwrath-m7-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = {
    snapshot: join(root, 'reports', 'snapshots', 'historical.json'),
    physicsBefore: join(root, 'reports', 'physics-old.json'),
    physicsAfter: join(root, 'reports', 'physics-new.json'),
    ...Object.fromEntries(Object.entries(scriptFiles).map(([k, name]) => [k, join(root, 'tools', name)])),
  };
  const snapshot = {
    snapshot_schema: 'star_wrath_offline_build_v1',
    machine: HOST,
    observed_utc: '2026-11-19T17:51:29.738579+00:00',
    executable: {
      filename: 'StarWrath.exe',
      sha256: 'c'.repeat(64),
      pe: { is_pe: true, machine_hex: '0x8664', pe_type: 'PE32+' },
      version_info: { ProductVersion: '0.10.10.53828(f37cda82a)' },
    },
    gamedata: {
      index: { filename: 'gamedata.index', sha256: SHA_B },
      package: { filename: 'gamedata.pk2', sha256: SHA_A },
      zstd_xml_scan: { xml_documents_parsed: 121 },
    },
    privacy: {
      absolute_input_paths_in_snapshot: false,
      data_written_from_game: false,
      included_raw_assets_or_logs: false,
    },
  };
  const physics = (role) => ({
    observed_utc: '2026-11-19T19:13:44.877615+00:00',
    files: {
      archive: { basename: 'gamedata.pk2', sha256: role === 'after' && mismatched ? 'd'.repeat(64) : SHA_A },
      index: { basename: 'gamedata.index', sha256: SHA_B },
    },
    scan: { incomplete, xml_documents_parsed: 119 },
  });
  const old = physics('before');
  const current = physics('after');
  const contents = {
    snapshot: JSON.stringify(snapshot) + '\n',
    physicsBefore: JSON.stringify(old) + '\n',
    physicsAfter: JSON.stringify(current) + '\n',
    ...Object.fromEntries(
      Object.keys(scriptFiles).map((role) => [role, '# Synthetic pinned source file for ' + role + '\n']),
    ),
  };
  for (const [role, filename] of Object.entries(paths)) {
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(filename, contents[role], 'utf8');
  }
  const input = Object.fromEntries(
    Object.entries(paths).map(([role, path]) => [role, { path, sha256: hash(Buffer.from(contents[role])) }]),
  );
  const plan = {
    schema: 'workbridge.research-plan.v1',
    planId: 'starwrath-test-saved',
    expectedHost: HOST,
    profile: 'starwrath.offline.v1',
    inputs: input,
    steps: [
      { id: 'identify', action: 'starwrath.snapshot-audit', needs: [] },
      { id: 'compare', action: 'starwrath.physics-compare', needs: ['identify'] },
      { id: 'correlate', action: 'starwrath.correlate', needs: ['identify', 'compare'] },
    ],
  };
  const planFile = join(root, 'plan.json');
  await writeFile(planFile, JSON.stringify(plan) + '\n');
  const outputDir = join(root, 'run');
  const fakePython = async () => ({
    schema: 'star-wrath-physics-report-diff-v1',
    previous: {
      index: { sha256: old.files.index.sha256 },
      archive: { sha256: old.files.archive.sha256 },
      scan_incomplete: old.scan.incomplete,
      observed_utc: old.observed_utc,
    },
    current: {
      index: { sha256: current.files.index.sha256 },
      archive: { sha256: current.files.archive.sha256 },
      scan_incomplete: current.scan.incomplete,
      observed_utc: current.observed_utc,
    },
    hash_changes: {
      index: old.files.index.sha256 !== current.files.index.sha256,
      archive: old.files.archive.sha256 !== current.files.archive.sha256,
    },
    coverage: {
      previous_incomplete: old.scan.incomplete,
      current_incomplete: current.scan.incomplete,
      same_scan_scope_and_no_reported_skips: !incomplete,
    },
    scan_count_changes: {},
    ship_design_summary_changes: {},
    numeric_parameter_changes: {
      global_scalar_parameters: [],
      global_array_numeric_tokens: [],
      'ship_design.numeric_identifiers': [],
    },
  });
  function provider(executeComparator = fakePython) {
    return createStarWrathProvider({ projectRoot: root, executeComparator });
  }
  function invocation(options = {}) {
    const selected = provider(options.executeComparator);
    return {
      planFile,
      outputDir,
      host: HOST,
      actions: selected.actions,
      verifiers: selected.verifiers,
      preflight: selected.preflight,
    };
  }
  return { root, paths, input, old, current, snapshot, plan, planFile, outputDir, provider, invocation };
}

test('Star Wrath profile validates with generic DAG, rejects invented actions', async (t) => {
  const f = await fixture(t);
  const valid = validatePlan(f.plan, { host: HOST });
  assert.deepEqual(
    valid.orderedSteps.map((s) => s.id),
    ['identify', 'compare', 'correlate'],
  );
  assert.equal(valid.executionMode, 'offline_saved_data');
  const malicious = structuredClone(f.plan);
  malicious.steps[1].action = 'shell.exec';
  assert.throws(
    () => validatePlan(malicious, { host: HOST }),
    (e) => e.code === 'UNKNOWN_ACTION',
  );
});

test('Star preflight verifies all seven saved source bytes before output creation', async (t) => {
  const f = await fixture(t);
  const result = await f.provider().preflight(validatePlan(f.plan, { host: HOST }), HOST);
  assert.equal(Object.keys(result).length, 7);
  assert.equal(result.comparator.kind, 'reviewed_python_source');
  assert.equal(result.snapshot.sha256, f.plan.inputs.snapshot.sha256);
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('second profile runs through generic engine and verifies saved evidence', async (t) => {
  const f = await fixture(t);
  const result = await runResearch(f.invocation());
  assert.equal(result.bundleVerified, true);
  assert.equal(result.stepCount, 3);
  assert.deepEqual(result.actions, [
    'starwrath.snapshot-audit',
    'starwrath.physics-compare',
    'starwrath.correlate',
  ]);
  const verified = await verifyResearchRun(f.outputDir, { verifiers: {} });
  assert.equal(verified.verified, true);
  assert.equal(verified.sourceSnapshotBound, true);
  const comparison = JSON.parse(await readFile(join(f.outputDir, 'steps', 'compare', 'result.json')));
  assert.equal(comparison.result.incomplete, true);
  assert.equal(comparison.result.exhaustive, false);
  const correlated = JSON.parse(await readFile(join(f.outputDir, 'steps', 'correlate', 'result.json')));
  assert.equal(correlated.result.physicsCurrentCorrespondsToSnapshotAssets, true);
  assert.equal(correlated.result.liveExecutionVerified, false);
});

test('separate historical reports are labeled distinct even with no measured value differences', async (t) => {
  const f = await fixture(t);
  // Different observation timestamps represent distinct archived report bytes.
  f.current.observed_utc = '2026-11-20T19:13:44.877615+00:00';
  const bytes = Buffer.from(JSON.stringify(f.current) + '\n');
  await writeFile(f.paths.physicsAfter, bytes);
  f.plan.inputs.physicsAfter.sha256 = hash(bytes);
  await writeFile(f.planFile, JSON.stringify(f.plan) + '\n');
  await runResearch(f.invocation());
  const result = JSON.parse(await readFile(join(f.outputDir, 'steps', 'compare', 'result.json')));
  assert.equal(result.result.comparisonMode, 'two_saved_reports');
  assert.equal(result.result.authorityOrLiveExecutionVerified, false);
});

test('cross-source mismatch blocks same-build attribution, not the independent offline comparison', async (t) => {
  const f = await fixture(t, { mismatched: true });
  await runResearch(f.invocation());
  const result = JSON.parse(await readFile(join(f.outputDir, 'steps', 'correlate', 'result.json')));
  assert.equal(result.result.archiveShaMatches, false);
  assert.equal(result.result.indexShaMatches, true);
  assert.equal(result.result.physicsCurrentCorrespondsToSnapshotAssets, false);
  assert.match(result.result.claim, /different archive\/index versions/);
});

test('complete synthetic scans keep complete-within-scope label but never live authority', async (t) => {
  const f = await fixture(t, { incomplete: false });
  await runResearch(f.invocation());
  const result = JSON.parse(await readFile(join(f.outputDir, 'steps', 'compare', 'result.json')));
  assert.equal(result.result.incomplete, false);
  assert.equal(result.result.exhaustive, true);
  assert.equal(result.result.authorityOrLiveExecutionVerified, false);
});

test('a changed pinned comparator script refuses before the coordinator creates a run', async (t) => {
  const f = await fixture(t);
  await writeFile(f.paths.comparator, 'changed while not approved\n');
  await assert.rejects(
    () => runResearch(f.invocation()),
    (e) => e.code === 'STAR_SOURCE_HASH',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('malicious comparator path is not arbitrary code execution', async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(f.plan);
  changed.inputs.comparator.path = join(f.root, 'tools', 'other.py');
  const selected = f.provider();
  await assert.rejects(
    () => selected.preflight(validatePlan(changed, { host: HOST }), HOST),
    (e) => e.code === 'STAR_TOOL_PATH',
  );
});

test('saved snapshot path outside reviewed snapshots root is refused', async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(f.plan);
  changed.inputs.snapshot.path = join(f.root, 'reports', 'different.json');
  await assert.rejects(
    () => f.provider().preflight(validatePlan(changed, { host: HOST }), HOST),
    (e) => e.code === 'STAR_SOURCE_SCOPE',
  );
});

test('wrong host is rejected before any saved input or code is run', async (t) => {
  const f = await fixture(t);
  await assert.rejects(
    () => runResearch({ ...f.invocation(), host: 'LEGION' }),
    (e) => e.code === 'WRONG_HOST',
  );
  await assert.rejects(access(f.outputDir), { code: 'ENOENT' });
});

test('snapshot with unsupported privacy claims refuses preflight', async (t) => {
  const f = await fixture(t);
  const changed = structuredClone(f.snapshot);
  changed.privacy.absolute_input_paths_in_snapshot = true;
  assert.throws(
    () => summarizeStarSnapshot(changed, HOST),
    (e) => e.code === 'STAR_REPORT_SCHEMA',
  );
});

test('a comparator response contradicting pinned hashes fails and produces no completion marker', async (t) => {
  const f = await fixture(t);
  const normal = await f.provider().actions['starwrath.physics-compare'];
  assert.equal(typeof normal, 'function');
  const wrong = async () => ({
    schema: 'star-wrath-physics-report-diff-v1',
    previous: {
      index: { sha256: '0'.repeat(64) },
      archive: { sha256: SHA_A },
      scan_incomplete: true,
      observed_utc: f.old.observed_utc,
    },
    current: {
      index: { sha256: SHA_B },
      archive: { sha256: SHA_A },
      scan_incomplete: true,
      observed_utc: f.current.observed_utc,
    },
    hash_changes: { index: false, archive: false },
    coverage: {
      previous_incomplete: true,
      current_incomplete: true,
      same_scan_scope_and_no_reported_skips: false,
    },
    numeric_parameter_changes: {
      global_scalar_parameters: [],
      global_array_numeric_tokens: [],
      'ship_design.numeric_identifiers': [],
    },
  });
  await assert.rejects(
    () => runResearch(f.invocation({ executeComparator: wrong })),
    (e) => e.code === 'STAR_COMPARATOR_RESULT',
  );
  await assert.rejects(access(join(f.outputDir, 'SHA256SUMS.txt')), { code: 'ENOENT' });
});

test('source tool mutated while comparison runs refuses final publication', async (t) => {
  const f = await fixture(t);
  const report = (
    await f.provider().actions['starwrath.snapshot-audit']({ plan: validatePlan(f.plan, { host: HOST }) })
  ).result;
  assert.equal(report.gameContacted, false);
  const fake = async () => {
    await writeFile(f.paths.indexInspector, 'unexpected source mutation\n');
    throw Object.assign(new Error('simulated interrupted dependency'), {
      code: 'TEST_COMPARATOR_INTERRUPTED',
    });
  };
  await assert.rejects(
    () => runResearch(f.invocation({ executeComparator: fake })),
    (e) => e.code === 'TEST_COMPARATOR_INTERRUPTED',
  );
  await assert.rejects(access(join(f.outputDir, 'SHA256SUMS.txt')), { code: 'ENOENT' });
});

test('changed Python source after the first step refuses execution before Python is invoked', async (t) => {
  const f = await fixture(t);
  let invoked = false;
  const fake = async () => {
    invoked = true;
    throw Error('Must not invoke a newly changed comparator script.');
  };
  await assert.rejects(
    () =>
      runResearch({
        ...f.invocation({ executeComparator: fake }),
        onStepCommitted: async (step, count) => {
          if (step.id === 'identify' && count === 1) {
            await writeFile(f.paths.comparator, '# source changed between admitted steps\n');
          }
        },
      }),
    (error) => error.code === 'STAR_SOURCE_HASH',
  );
  assert.equal(invoked, false);
  await assert.rejects(access(join(f.outputDir, 'SHA256SUMS.txt')), { code: 'ENOENT' });
});

test('a source path under a directory junction cannot redirect a reviewed file', async (t) => {
  const f = await fixture(t);
  const external = join(f.root, 'outside-snapshots');
  const junction = join(f.root, 'reports', 'snapshots', 'redirect');
  await mkdir(external);
  await writeFile(join(external, 'historical.json'), JSON.stringify(f.snapshot) + '\n');
  try {
    await symlink(external, junction, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) {
      t.skip('Windows filesystem does not permit creating a disposable junction');
      return;
    }
    throw error;
  }
  const changed = structuredClone(f.plan);
  changed.inputs.snapshot.path = join(junction, 'historical.json');
  changed.inputs.snapshot.sha256 = hash(await readFile(join(external, 'historical.json')));
  await assert.rejects(
    () => f.provider().preflight(validatePlan(changed, { host: HOST }), HOST),
    (error) => error.code === 'STAR_SOURCE_LINK',
  );
});

test('tampering with saved second-project result fails generic independent verification', async (t) => {
  const f = await fixture(t);
  await runResearch(f.invocation());
  await writeFile(join(f.outputDir, 'steps', 'identify', 'result.json'), '{"forged":true}\n');
  await assert.rejects(
    () => verifyResearchRun(f.outputDir, { verifiers: {} }),
    (e) => e.code === 'RUN_STEP_INVALID',
  );
});
