import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { HOSTED_RIFT_FILES, LOCAL_RIFT_FILES, inventoryRiftTests } from '../scripts/ci-rift-test-runner.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'wb-ci-rift-inventory-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const name of [...HOSTED_RIFT_FILES, ...LOCAL_RIFT_FILES]) {
    await writeFile(join(root, name), '');
  }
  return root;
}

test('RIFT CI classifies every current suite exactly once', async () => {
  const inventory = await inventoryRiftTests();
  assert.ok(inventory.hosted.length > 0);
  assert.ok(inventory.local.length > 0);
  assert.equal(new Set([...inventory.hosted, ...inventory.local]).size, inventory.all.length);
});

test('an unclassified new RIFT suite fails the CI inventory', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'new.test.mjs'), '');
  await assert.rejects(inventoryRiftTests(root), /CI_RIFT_INVENTORY_MISMATCH.*new\.test\.mjs/);
});

test('a removed or renamed RIFT suite fails the CI inventory', async (t) => {
  const root = await fixture(t);
  await rm(join(root, HOSTED_RIFT_FILES[0]));
  await assert.rejects(inventoryRiftTests(root), /CI_RIFT_INVENTORY_MISMATCH.*live-witness\.test\.mjs/);
});

test('a directory masquerading as a test file is rejected', async (t) => {
  const root = await fixture(t);
  await rm(join(root, HOSTED_RIFT_FILES[0]));
  await mkdir(join(root, HOSTED_RIFT_FILES[0]));
  await assert.rejects(inventoryRiftTests(root), /CI_RIFT_NONREGULAR_TEST/);
});
