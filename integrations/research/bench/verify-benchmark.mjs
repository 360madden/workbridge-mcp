#!/usr/bin/env node
/**
 * M8: repeatable local benchmark of the exact saved research package verifier.
 *
 * Reads saved offline evidence ONLY; no client, project tools, subprocess,
 * network, source mutation, or external AI API. Sample durations are
 * observations, never performance acceptance thresholds or game freshness.
 */
import { lstat, readdir } from 'node:fs/promises';
import { hostname } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyResearchRun } from '../src/run.mjs';

export const BENCHMARK_SCHEMA = 'workbridge.research-verification-benchmark.v1';
const MAX_FILES = 4096;
const MAX_DEPTH = 16;
const MAX_TRACKED_BYTES = 8 * 1024 ** 3;
const MAX_BUNDLES = 4;

export class BenchmarkError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BenchmarkError';
    this.code = code;
  }
}
function refuse(code, message) {
  throw new BenchmarkError(code, message);
}
function boundedSamples(repeats) {
  if (!Number.isSafeInteger(repeats) || repeats < 2 || repeats > 30) {
    refuse('BENCH_SAMPLES', 'Use an integer 2..30 for repeat count.');
  }
  return repeats;
}
function round(value) {
  return Math.round(value * 1000) / 1000;
}
export function summarizeDurations(values) {
  if (!Array.isArray(values) || !values.length || values.some((v) => !Number.isFinite(v) || v < 0)) {
    refuse('BENCH_DURATION_INVALID', 'Invalid duration sample.');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.ceil(sorted.length * fraction) - 1];
  const middle = Math.floor(sorted.length / 2);
  return {
    minMs: round(sorted[0]),
    medianMs: round(sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2),
    p90Ms: round(percentile(0.9)),
    maxMs: round(sorted.at(-1)),
    averageMs: round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length),
  };
}

export async function savedPackageInventory(folder) {
  const root = resolve(folder);
  const queue = [{ pathname: root, depth: 0 }];
  let files = 0;
  let directories = 0;
  let bytes = 0;
  while (queue.length) {
    const { pathname, depth } = queue.pop();
    const stat = await lstat(pathname);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      refuse('BENCH_UNSAFE_ENTRY', 'Evidence tree contains a redirected or unsupported filesystem entry.');
    }
    if (stat.isFile()) {
      files++;
      bytes += stat.size;
      if (files > MAX_FILES || bytes > MAX_TRACKED_BYTES || !Number.isSafeInteger(bytes)) {
        refuse('BENCH_INVENTORY_LIMIT', 'Evidence inventory exceeds bounded inspection limits.');
      }
    } else {
      directories++;
      if (depth >= MAX_DEPTH) refuse('BENCH_INVENTORY_DEPTH', 'Evidence directory tree is too deep.');
      const entries = await readdir(pathname);
      if (entries.length > MAX_FILES) refuse('BENCH_INVENTORY_LIMIT', 'Directory has excessive entries.');
      for (const entry of entries) queue.push({ pathname: join(pathname, entry), depth: depth + 1 });
    }
  }
  if (!files) refuse('BENCH_EMPTY_PACKAGE', 'Saved research directory contains no files.');
  return { files, directories, totalStoredBytes: bytes };
}

/**
 * One warm-up followed by full independent verification on EVERY sample.
 * No files are changed; the verifier still rejects tampered or incomplete runs.
 */
export async function benchmarkSavedPackage({
  directory,
  repeats = 7,
  verify = verifyResearchRun,
  clock = () => process.hrtime.bigint(),
} = {}) {
  if (typeof directory !== 'string' || !directory || directory.includes('\0')) {
    refuse('BENCH_DIRECTORY', 'An existing saved research package path is required.');
  }
  boundedSamples(repeats);
  if (typeof verify !== 'function' || typeof clock !== 'function') {
    refuse('BENCH_ARGUMENTS', 'Invalid verifier or monotonic clock.');
  }
  const root = resolve(directory);
  const inventoryBefore = await savedPackageInventory(root);
  const initial = await verify(root);
  if (
    initial?.verified !== true ||
    initial.savedEvidenceOnly !== true ||
    initial.currentGameStateVerified !== false
  ) {
    refuse('BENCH_VERIFIER_UNQUALIFIED', 'Saved package is not independently verified as offline evidence.');
  }
  const samples = [];
  for (let i = 0; i < repeats; i++) {
    const start = clock();
    const outcome = await verify(root);
    const end = clock();
    if (
      outcome?.verified !== true ||
      outcome.planId !== initial.planId ||
      outcome.stepCount !== initial.stepCount ||
      outcome.sourceSnapshotBound !== initial.sourceSnapshotBound ||
      outcome.currentGameStateVerified !== false ||
      end < start
    ) {
      refuse('BENCH_VERIFICATION_CHANGED', 'Evidence verification changed during sampling.');
    }
    samples.push(Number(end - start) / 1e6);
  }
  const inventoryAfter = await savedPackageInventory(root);
  if (JSON.stringify(inventoryBefore) !== JSON.stringify(inventoryAfter)) {
    refuse('BENCH_INVENTORY_CHANGED', 'Evidence inventory changed during sampling.');
  }
  return {
    schema: BENCHMARK_SCHEMA,
    planId: initial.planId,
    stepCount: initial.stepCount,
    sourceSnapshotBound: initial.sourceSnapshotBound,
    resumedWithClaimVerified: initial.resumedWithClaimVerified ?? false,
    repeatCount: repeats,
    warmupVerifications: 1,
    verifiedSampleCount: repeats,
    observedDurationsMs: samples.map(round),
    ...summarizeDurations(samples),
    inventory: inventoryAfter,
    hostObserved: hostname(),
    savedEvidenceOnly: true,
    currentGameStateVerified: false,
    gameContacted: false,
    claims:
      'timings describe offline saved-package verification only; no latency SLA or current-game evidence',
  };
}

export function parseBenchmarkArguments(args) {
  const bundles = [];
  let repeats = 7;
  let seenRepeats = false;
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[++i];
    if (!value || value.startsWith('--'))
      refuse('BENCH_CLI_ARGUMENTS', 'Use --bundle PATH and optional --repeats N.');
    if (flag === '--bundle') {
      if (bundles.length >= MAX_BUNDLES)
        refuse('BENCH_BUNDLES', 'At most four saved packages may be measured.');
      bundles.push(value);
    } else if (flag === '--repeats' && !seenRepeats && /^[0-9]{1,2}$/.test(value)) {
      repeats = boundedSamples(Number(value));
      seenRepeats = true;
    } else {
      refuse('BENCH_CLI_ARGUMENTS', 'Unknown or repeated benchmark argument.');
    }
  }
  if (!bundles.length) refuse('BENCH_BUNDLES', 'Select one to four saved package directories.');
  if (new Set(bundles.map((item) => resolve(item).toLowerCase())).size !== bundles.length) {
    refuse('BENCH_BUNDLES', 'Duplicate saved package directories are not permitted.');
  }
  return { bundles, repeats };
}

export async function benchmarkCli(args = process.argv.slice(2)) {
  const parsed = parseBenchmarkArguments(args);
  const results = [];
  for (const directory of parsed.bundles) {
    results.push(await benchmarkSavedPackage({ directory, repeats: parsed.repeats }));
  }
  return {
    schema: 'workbridge.research-benchmark-batch.v1',
    benchmarkCount: results.length,
    results,
    noGameContact: true,
    savedEvidenceOnly: true,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  benchmarkCli()
    .then((result) => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch((error) => {
      process.stderr.write(
        JSON.stringify({ ok: false, code: error.code ?? 'BENCHMARK_FAILED', message: error.message }) + '\n',
      );
      process.exitCode = 2;
    });
}
