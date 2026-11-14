import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePurgeInventory } from '../scripts/storage-retention-purge-inventory.mjs';

const root = { volume: '1'.repeat(16), id: '1'.repeat(32) };
const entry = (path, type, id) => ({
  path,
  type,
  identity: { volume: root.volume, id: id.repeat(32) },
  size: type === 'file' ? 1 : 0,
  nlink: 1,
  sha256: type === 'file' ? 'a'.repeat(64) : null,
});
const fixture = () => ({
  schema: 'workbridge-retention-inventory/1',
  complete: true,
  nonAtomic: true,
  namedStreams: 0,
  totalBytes: 1,
  entries: [entry('dir/a', 'file', '3'), entry('dir', 'directory', '2'), entry('', 'directory', '1')],
});

test('native inventory is ordered deterministically and remains non-authorizing', () => {
  const output = normalizePurgeInventory(fixture(), root);
  assert.deepEqual(
    output.entries.map((item) => item.path),
    ['', 'dir', 'dir/a'],
  );
  assert.equal(output.mutationAuthorized, false);
  assert.equal(output.nonAtomic, true);
});

test('wrong root, volume, streams and partial snapshots cannot become valid inventory', () => {
  for (const alter of [
    (value) => {
      value.entries[2].identity.id = '4'.repeat(32);
    },
    (value) => {
      value.entries[0].identity.volume = '4'.repeat(16);
    },
    (value) => {
      value.namedStreams = 1;
    },
    (value) => {
      value.complete = false;
    },
    (value) => {
      value.totalBytes = 2;
    },
  ]) {
    const value = fixture();
    alter(value);
    assert.throws(() => normalizePurgeInventory(value, root), { code: 'PURGE_INVENTORY_INVALID' });
  }
});

test('unsafe paths, duplicate identities and case aliases, missing parents and unknown fields refuse', () => {
  for (const alter of [
    (value) => {
      value.entries[0].path = '../outside';
    },
    (value) => {
      value.entries[0].path = 'dir/NUL.txt';
    },
    (value) => {
      value.entries[0].path = 'dir/\ud800';
    },
    (value) => {
      value.entries[0].identity.id = value.entries[1].identity.id;
    },
    (value) => {
      value.entries.push(entry('DIR', 'directory', '4'));
    },
    (value) => {
      value.entries.splice(1, 1);
    },
    (value) => {
      value.entries[0].nlink = 2;
    },
    (value) => {
      value.futureProof = true;
    },
  ]) {
    const value = fixture();
    alter(value);
    assert.throws(() => normalizePurgeInventory(value, root), { code: 'PURGE_INVENTORY_INVALID' });
  }
});
