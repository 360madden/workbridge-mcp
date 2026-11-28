#!/usr/bin/env node
// Hosted regression lane: no live RIFT, sibling repositories or archived game builds.
// Explicitly classify every suite so future additions cannot silently escape review.
import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const testRoot = path.join(root, 'integrations', 'rift', 'test');

export const HOSTED_RIFT_FILES = Object.freeze([
  'live-witness.test.mjs',
  'physical-receipt.test.mjs',
  'physical.test.mjs',
  'workspace-path.test.mjs',
]);

// These suites require an actual sibling analyzer, archived PE, or local Python environment.
// Keep them in the full npm test / WB-001 host acceptance; never replace those checks.
export const LOCAL_RIFT_FILES = Object.freeze([
  'archived.test.mjs',
  'compatibility.test.mjs',
  'patch.test.mjs',
  'research-doctor.test.mjs',
  'session.test.mjs',
  'telemetry-function-relations.test.mjs',
  'telemetry-inbound-callgraph.test.mjs',
  'telemetry-locator-context.test.mjs',
  'telemetry-locator-drift.test.mjs',
  'telemetry-locator-xrefs.test.mjs',
]);

export async function inventoryRiftTests(directory = testRoot) {
  const entries = (await readdir(directory, { withFileTypes: true })).filter(({ name }) =>
    name.endsWith('.test.mjs'),
  );
  if (entries.some((entry) => !entry.isFile())) throw new Error('CI_RIFT_NONREGULAR_TEST');
  const expected = [...HOSTED_RIFT_FILES, ...LOCAL_RIFT_FILES];
  if (new Set(expected).size !== expected.length) throw new Error('CI_RIFT_DUPLICATE_CLASSIFICATION');
  const actual = entries.map(({ name }) => name).sort();
  const unknown = actual.filter((name) => !expected.includes(name));
  const missing = expected.filter((name) => !actual.includes(name));
  if (unknown.length || missing.length) {
    throw new Error('CI_RIFT_INVENTORY_MISMATCH: ' + JSON.stringify({ unknown, missing }));
  }
  return { all: actual, hosted: [...HOSTED_RIFT_FILES], local: [...LOCAL_RIFT_FILES] };
}

async function main() {
  const [mode, ...extra] = process.argv.slice(2);
  if (extra.length || !['inventory', 'hosted'].includes(mode)) throw new Error('CI_RIFT_MODE_INVALID');
  // Nested node:test launches can silently omit test files.
  if (process.env.NODE_TEST_CONTEXT) throw new Error('CI_RIFT_RECURSIVE_TEST_CONTEXT');

  const inventory = await inventoryRiftTests();
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      mode,
      totalFiles: inventory.all.length,
      hostedFiles: inventory.hosted,
      localOnlyFiles: inventory.local,
    }),
  );
  if (mode === 'inventory') return;

  // Windows path and executable identity contracts are intentionally tested on Windows.
  if (process.platform !== 'win32') throw new Error('CI_RIFT_WINDOWS_REQUIRED');
  const result = spawnSync(
    process.execPath,
    ['--test', '--test-concurrency=4', ...inventory.hosted.map((name) => path.join(testRoot, name))],
    {
      cwd: root,
      windowsHide: true,
      shell: false,
      stdio: 'inherit',
      timeout: 120_000,
    },
  );
  if (result.error?.code === 'ETIMEDOUT') throw new Error('CI_RIFT_TEST_TIMEOUT');
  if (result.error || result.signal || result.status === null) throw new Error('CI_RIFT_TEST_RUNNER_FAILED');
  if (result.status !== 0) process.exitCode = result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
