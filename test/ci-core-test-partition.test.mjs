import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { ISOLATED_CORE_FILES, partitionCoreTests } from '../scripts/ci-core-test-runner.mjs';

const sourceScript = fileURLToPath(new URL('../scripts/ci-core-test-runner.mjs', import.meta.url));
const testDirectory = fileURLToPath(new URL('./', import.meta.url));

test('core CI partitions every test file exactly once without changing the suite', async () => {
  const actual = (await readdir(testDirectory)).filter((name) => name.endsWith('.test.mjs')).sort();
  const partition = await partitionCoreTests();
  assert.deepEqual(partition.all, actual);
  assert.deepEqual(partition.parallel, partition.parallel.toSorted());
  assert.equal(partition.isolated.length, 3);
  assert.deepEqual(partition.isolated, [...ISOLATED_CORE_FILES]);
  assert.deepEqual([...partition.parallel, ...partition.isolated].sort(), actual);
  assert.equal(new Set([...partition.parallel, ...partition.isolated]).size, actual.length);
  assert.ok(partition.parallel.every((name) => !ISOLATED_CORE_FILES.includes(name)));
});

test('partition rejects missing isolated cases and unexpected nonregular test entries', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-core-ci-partition-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  const tests = path.join(root, 'test');
  await mkdir(scripts);
  await mkdir(tests);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const copiedScript = path.join(scripts, 'ci-core-test-runner.mjs');
  await copyFile(sourceScript, copiedScript);

  const names = [...ISOLATED_CORE_FILES, 'alpha.test.mjs', 'zeta.test.mjs'];
  for (const name of names) await writeFile(path.join(tests, name), '// test fixture\n');
  const { partitionCoreTests: fixturePartition } = await import(pathToFileURL(copiedScript).href);
  assert.equal((await fixturePartition()).all.length, names.length);

  await rm(path.join(tests, ISOLATED_CORE_FILES[0]));
  await assert.rejects(fixturePartition(), { message: 'CI_CORE_PARTITION_INVALID' });
  await writeFile(path.join(tests, ISOLATED_CORE_FILES[0]), '// restored fixture\n');

  await mkdir(path.join(tests, 'not-a-file.test.mjs'));
  await assert.rejects(fixturePartition(), { message: 'CI_CORE_NONREGULAR_TEST' });
});

test('the launcher executes each isolated fixture only in its assigned partition', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wb-core-ci-launcher-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = path.join(root, 'scripts');
  const tests = path.join(root, 'test');
  await mkdir(scripts);
  await mkdir(tests);
  await writeFile(path.join(root, 'package.json'), '{"type":"module"}');
  const copiedScript = path.join(scripts, 'ci-core-test-runner.mjs');
  await copyFile(sourceScript, copiedScript);

  const cases = [...ISOLATED_CORE_FILES, 'alpha.test.mjs', 'zeta.test.mjs'];
  for (const name of cases) await writeFile(path.join(tests, name), '// passing fixture\n');
  // Do not inherit the parent test worker's NODE_TEST_CONTEXT: nested Node
  // test runners otherwise skip every file while returning a false success.
  const childEnvironment = { ...process.env };
  delete childEnvironment.NODE_TEST_CONTEXT;
  const invoke = (mode) =>
    spawnSync(process.execPath, [copiedScript, mode], {
      windowsHide: true,
      shell: false,
      encoding: 'utf8',
      timeout: 15000,
      env: childEnvironment,
    });
  for (const mode of ['parallel', 'isolated']) {
    const result = invoke(mode);
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
    const [header] = result.stdout.split(/\r?\n/);
    assert.match(result.stdout, new RegExp('\\btests ' + (mode === 'parallel' ? 2 : 3) + '\\b'));
    assert.doesNotMatch(result.stderr, /node:test run\(\) is being called recursively/);
    assert.deepEqual(
      { mode: JSON.parse(header).mode, total: JSON.parse(header).totalFiles },
      { mode, total: cases.length },
    );
  }

  await writeFile(path.join(tests, 'alpha.test.mjs'), 'throw Error("fixture intentional failure");\n');
  const failed = invoke('parallel');
  assert.equal(failed.status, 1, failed.stdout);
  assert.match(failed.stdout, /fixture intentional failure/);
  assert.equal(invoke('isolated').status, 0);
});

test('CI runner refuses recursive Node test contexts instead of reporting false success', () => {
  const result = spawnSync(process.execPath, [sourceScript, 'inventory'], {
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_TEST_CONTEXT: 'child-v8' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI_CORE_RECURSIVE_TEST_CONTEXT/);
  assert.equal(result.stdout, '');
});

test('partition command rejects invalid modes instead of selecting a partial suite', () => {
  const result = spawnSync(process.execPath, [sourceScript, 'unrecognized-mode'], {
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
    timeout: 10000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CI_CORE_MODE_INVALID/);
  assert.equal(result.stdout, '');
});
