#!/usr/bin/env node
// Every test/*.test.mjs file appears exactly once across separate CI runner partitions.
// The original (unpartitioned) core suite remains unchanged for WB-001 host acceptance.
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testRoot = path.join(root, 'test');
const MAX_FILES = 500;
const TEST_TIMEOUT_MS = 12 * 60 * 1000;

export const ISOLATED_CORE_FILES = Object.freeze([
  'independence.test.mjs',
  'local-service-concurrency.test.mjs',
  'storage-retention-purge-proof-e2e.test.mjs',
]);

export async function partitionCoreTests() {
  const entries = await readdir(testRoot, { withFileTypes: true });
  const candidates = entries.filter(({ name }) => name.endsWith('.test.mjs'));
  if (candidates.length <= ISOLATED_CORE_FILES.length || candidates.length > MAX_FILES)
    throw new Error('CI_CORE_FILE_COUNT');
  if (candidates.some((entry) => !entry.isFile())) throw new Error('CI_CORE_NONREGULAR_TEST');

  const all = candidates.map((entry) => entry.name).sort();
  const unique = new Set(all);
  const isolated = new Set(ISOLATED_CORE_FILES);
  if (
    unique.size !== all.length ||
    isolated.size !== ISOLATED_CORE_FILES.length ||
    ISOLATED_CORE_FILES.some((name) => !unique.has(name))
  )
    throw new Error('CI_CORE_PARTITION_INVALID');

  const parallel = all.filter((name) => !isolated.has(name));
  if (parallel.length + isolated.size !== all.length || parallel.some((name) => isolated.has(name)))
    throw new Error('CI_CORE_PARTITION_INVALID');
  return { all, parallel, isolated: [...ISOLATED_CORE_FILES] };
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !['inventory', 'parallel', 'isolated'].includes(mode))
    throw new Error('CI_CORE_MODE_INVALID');
  // node:test marks child workers with this variable. A nested --test invocation
  // can silently skip files and report exit 0, so fail instead of claiming coverage.
  if (process.env.NODE_TEST_CONTEXT) throw new Error('CI_CORE_RECURSIVE_TEST_CONTEXT');

  const partition = await partitionCoreTests();
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      mode,
      totalFiles: partition.all.length,
      parallelFiles: partition.parallel.length,
      isolatedFiles: partition.isolated.length,
      completePartition: true,
    }),
  );
  if (mode === 'inventory') return;

  const chosen = mode === 'parallel' ? partition.parallel : partition.isolated;
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--test-concurrency=' + (mode === 'parallel' ? '4' : '1'),
      ...chosen.map((name) => path.join(testRoot, name)),
    ],
    {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: 'inherit',
      timeout: TEST_TIMEOUT_MS,
    },
  );
  if (result.error?.code === 'ETIMEDOUT') throw new Error('CI_CORE_TEST_TIMEOUT');
  if (result.error || result.signal || result.status === null) throw new Error('CI_CORE_TEST_RUNNER_FAILED');
  if (result.status !== 0) process.exitCode = result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
