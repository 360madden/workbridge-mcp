import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  BENCHMARK_SCHEMA,
  benchmarkSavedPackage,
  parseBenchmarkArguments,
  savedPackageInventory,
  summarizeDurations,
} from '../bench/verify-benchmark.mjs';

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'wb-m8-benchmark-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'steps', 'identify'), { recursive: true });
  await writeFile(join(dir, 'input.plan.json'), '{"id":"synthetic"}\n');
  await writeFile(join(dir, 'steps', 'identify', 'result.json'), '{"status":"completed"}\n');
  return dir;
}
function good() {
  return {
    verified: true,
    planId: 'synthetic-benchmark-fixture',
    stepCount: 1,
    sourceSnapshotBound: true,
    resumedWithClaimVerified: false,
    savedEvidenceOnly: true,
    currentGameStateVerified: false,
  };
}

test('durations sort before median/p90 and contain bounded decimal units', () => {
  assert.deepEqual(summarizeDurations([3, 1, 7, 2]), {
    minMs: 1,
    medianMs: 2.5,
    p90Ms: 7,
    maxMs: 7,
    averageMs: 3.25,
  });
  assert.throws(
    () => summarizeDurations([2, Number.NaN]),
    (e) => e.code === 'BENCH_DURATION_INVALID',
  );
});

test('pure read-only inventory counts all nested files and stored bytes', async (t) => {
  const dir = await fixture(t);
  const before = await readFile(join(dir, 'input.plan.json'));
  const inventory = await savedPackageInventory(dir);
  assert.equal(inventory.files, 2);
  assert.equal(inventory.directories, 3);
  assert.ok(inventory.totalStoredBytes > 20);
  assert.deepEqual(await readFile(join(dir, 'input.plan.json')), before);
});

test('bench invokes independent verifier for warmup plus every sample', async (t) => {
  const dir = await fixture(t);
  let count = 0;
  let tick = 0n;
  const result = await benchmarkSavedPackage({
    directory: dir,
    repeats: 4,
    verify: async () => {
      count++;
      return good();
    },
    clock: () => {
      tick += 1_000_000n;
      return tick;
    },
  });
  assert.equal(count, 5);
  assert.equal(result.schema, BENCHMARK_SCHEMA);
  assert.equal(result.verifiedSampleCount, 4);
  assert.equal(result.warmupVerifications, 1);
  assert.deepEqual(result.observedDurationsMs, [1, 1, 1, 1]);
  assert.equal(result.sourceSnapshotBound, true);
  assert.equal(result.currentGameStateVerified, false);
  assert.equal(result.gameContacted, false);
});

test('strict argument bounds prevent excessive measurements or missing package targets', async (t) => {
  const dir = await fixture(t);
  for (const invalid of [0, 1, 31, 5.5, NaN]) {
    await assert.rejects(
      () => benchmarkSavedPackage({ directory: dir, repeats: invalid, verify: good }),
      (e) => e.code === 'BENCH_SAMPLES',
    );
  }
  assert.throws(
    () => parseBenchmarkArguments([]),
    (e) => e.code === 'BENCH_BUNDLES',
  );
  assert.throws(
    () => parseBenchmarkArguments(['--bundle', dir, '--bundle', dir]),
    (e) => e.code === 'BENCH_BUNDLES',
  );
  assert.throws(
    () => parseBenchmarkArguments(['--bundle', dir, '--cmd', 'powershell']),
    (e) => e.code === 'BENCH_CLI_ARGUMENTS',
  );
  assert.deepEqual(parseBenchmarkArguments(['--bundle', dir, '--repeats', '3']).repeats, 3);
});

test('failed or ambiguous verifier blocks a benchmark result', async (t) => {
  const dir = await fixture(t);
  await assert.rejects(
    () =>
      benchmarkSavedPackage({
        directory: dir,
        repeats: 2,
        verify: async () => ({ ...good(), verified: false }),
      }),
    (e) => e.code === 'BENCH_VERIFIER_UNQUALIFIED',
  );
});

test('changing verification result between samples fails closed', async (t) => {
  const dir = await fixture(t);
  let n = 0;
  await assert.rejects(
    () =>
      benchmarkSavedPackage({
        directory: dir,
        repeats: 2,
        verify: async () => ({ ...good(), stepCount: ++n > 1 ? 2 : 1 }),
      }),
    (e) => e.code === 'BENCH_VERIFICATION_CHANGED',
  );
});

test('detects evidence size changes even when verifier falsely returns success', async (t) => {
  const dir = await fixture(t);
  let n = 0;
  await assert.rejects(
    () =>
      benchmarkSavedPackage({
        directory: dir,
        repeats: 2,
        verify: async () => {
          n++;
          if (n === 2)
            await writeFile(join(dir, 'steps', 'identify', 'result.json'), 'changed benchmark fixture\n');
          return good();
        },
      }),
    (e) => e.code === 'BENCH_INVENTORY_CHANGED',
  );
});
