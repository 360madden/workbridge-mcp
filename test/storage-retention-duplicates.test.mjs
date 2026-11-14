import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, link, lstat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { verifyRuntimeDuplicate } from '../scripts/storage-retention-duplicates.mjs';

const contents = {
  'dist/app.js': 'app',
  'node_modules/pkg/index.js': 'pkg',
  'package.json': '{}',
  'package-lock.json': '{ }',
};
const manifest = Object.entries(contents).map(([name, text]) => ({
  path: name,
  bytes: Buffer.byteLength(text),
  sha256: createHash('sha256').update(text).digest('hex'),
}));
async function fixture() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'wb-duplicate-'));
  const roots = [path.join(temp, 'source'), path.join(temp, 'retained')];
  for (const root of roots)
    for (const [name, content] of Object.entries(contents)) {
      const file = path.join(root, ...name.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content);
    }
  return {
    temp,
    roots,
    args: { resourceRoot: roots[0], retainedRoot: roots[1], manifestFiles: manifest },
    cleanup: () => rm(temp, { force: true, recursive: true }),
  };
}

test('requires both exact runtime trees and hashes, never grants mutation eligibility', async () => {
  const f = await fixture();
  try {
    const result = await verifyRuntimeDuplicate(f.args);
    assert.equal(result.verifiedDuplicate, true, result.reason);
    assert.equal(result.mutationEligible, false);
    assert.equal(result.nonAtomic, true);
    assert.equal(result.filesHashed, 8);
    assert.equal(result.bytesHashed, 22);
  } finally {
    await f.cleanup();
  }
});

test('same-size corrupted retained file cannot prove duplicate', async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.roots[1], 'dist/app.js'), 'bad');
    const result = await verifyRuntimeDuplicate(f.args);
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'HASH_MISMATCH');
  } finally {
    await f.cleanup();
  }
});

test('rejects missing and extra entries, including empty directories', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.roots[0], 'dist', 'extra'));
    assert.equal((await verifyRuntimeDuplicate(f.args)).reason, 'UNEXPECTED_ENTRY');
    await rm(path.join(f.roots[0], 'dist', 'extra'), { recursive: true });
    await rm(path.join(f.roots[1], 'package.json'));
    assert.equal((await verifyRuntimeDuplicate(f.args)).reason, 'MISSING_ENTRY');
  } finally {
    await f.cleanup();
  }
});

test('release payload mode ignores only unrelated retained top-level entries', async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.roots[1], 'src'));
    await writeFile(path.join(f.roots[1], 'src', 'ignored'), 'unrelated');
    assert.equal((await verifyRuntimeDuplicate(f.args)).verifiedDuplicate, false);
    const subsetResult = await verifyRuntimeDuplicate({ ...f.args, retainedRuntimeSubset: true });
    assert.equal(subsetResult.verifiedDuplicate, true, JSON.stringify(subsetResult));
    await writeFile(path.join(f.roots[0], 'extra'), 'no');
    assert.equal(
      (await verifyRuntimeDuplicate({ ...f.args, retainedRuntimeSubset: true })).verifiedDuplicate,
      false,
    );
  } finally {
    await f.cleanup();
  }
});

test('rejects unsafe and colliding manifest paths before reading', async () => {
  const f = await fixture();
  try {
    for (const unsafe of ['../outside', 'dist/../x', 'C:\\secret', 'dist/file:stream', 'dist/foo.']) {
      const r = await verifyRuntimeDuplicate({
        ...f.args,
        manifestFiles: [...manifest, { ...manifest[0], path: unsafe }],
      });
      assert.equal(r.verifiedDuplicate, false, unsafe);
    }
    assert.equal(
      (
        await verifyRuntimeDuplicate({
          ...f.args,
          manifestFiles: [...manifest, { ...manifest[0], path: 'DIST\\APP.JS' }],
        })
      ).reason,
      'MANIFEST_COLLISION',
    );
    assert.equal(
      (await verifyRuntimeDuplicate({ ...f.args, retainedRoot: f.roots[0] })).reason,
      'OVERLAPPING_ROOTS',
    );
  } finally {
    await f.cleanup();
  }
});

test('hardlinked runtime entries refuse proof', async () => {
  const f = await fixture();
  try {
    const file = path.join(f.roots[0], 'dist/app.js');
    const outside = path.join(f.temp, 'outside');
    await writeFile(outside, 'app');
    await rm(file);
    await link(outside, file);
    assert.equal((await verifyRuntimeDuplicate(f.args)).reason, 'HARDLINK');
  } finally {
    await f.cleanup();
  }
});

test('bounds and a changed file between enumeration and open fail closed', async () => {
  const f = await fixture();
  try {
    assert.equal(
      (await verifyRuntimeDuplicate({ ...f.args, limits: { maxEntries: 1 } })).reason,
      'ENTRY_LIMIT',
    );
    assert.equal((await verifyRuntimeDuplicate({ ...f.args, limits: { maxBytes: 5 } })).reason, 'BYTE_LIMIT');
    let changed = false;
    const result = await verifyRuntimeDuplicate(f.args, {
      beforeOpen: async (file) => {
        if (!changed) {
          changed = true;
          await writeFile(file, 'not the same');
        }
      },
    });
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'FILE_CHANGED');
  } finally {
    await f.cleanup();
  }
});

test('linked ancestry fails closed', async () => {
  const f = await fixture();
  try {
    const alias = path.join(f.temp, 'alias');
    await symlink(f.roots[0], alias, 'junction');
    const result = await verifyRuntimeDuplicate({ ...f.args, resourceRoot: alias });
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'LINK_OR_REPARSE');
  } finally {
    await f.cleanup();
  }
});

test('mutation after an earlier file was hashed invalidates final proof', async () => {
  const f = await fixture();
  try {
    let changed = false;
    const result = await verifyRuntimeDuplicate(f.args, {
      beforeOpen: async (file) => {
        if (!changed && file.startsWith(f.roots[1])) {
          changed = true;
          await writeFile(path.join(f.roots[0], 'dist/app.js'), 'bad');
        }
      },
    });
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'FILE_CHANGED');
  } finally {
    await f.cleanup();
  }
});

test('metadata checks are cached by unchanged stamp within one proof', async () => {
  const f = await fixture();
  try {
    const calls = new Map();
    let closed = false;
    const metadata = {
      check: async (file) => {
        calls.set(file, (calls.get(file) ?? 0) + 1);
      },
      close: () => {
        closed = true;
      },
    };
    const result = await verifyRuntimeDuplicate(f.args, { metadata });
    assert.equal(result.verifiedDuplicate, true, result.reason);
    assert.equal(calls.get(f.roots[0]), 1);
    assert.equal(calls.get(path.join(f.roots[0], 'dist', 'app.js')), 1);
    assert.equal(closed, true);
  } finally {
    await f.cleanup();
  }
});

test('changed stamp triggers a fresh metadata check and invalidates proof', async () => {
  const f = await fixture();
  try {
    const target = path.join(f.roots[0], 'dist', 'app.js');
    let checks = 0;
    const metadata = {
      check: async (file) => {
        if (file === target && ++checks > 1 && (await lstat(file)).size !== 3)
          throw Object.assign(new Error('reparse'), { code: 'REPARSE_POINT_SKIPPED' });
      },
      close: () => {},
    };
    let changed = false;
    const result = await verifyRuntimeDuplicate(f.args, {
      metadata,
      beforeOpen: async (file) => {
        if (!changed && file === target) {
          changed = true;
          await writeFile(file, 'changed');
        }
      },
    });
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'REPARSE_POINT_SKIPPED');
    assert.equal(checks, 2);
  } finally {
    await f.cleanup();
  }
});

test('unrelated churn in a shared ancestor retries metadata without weakening tree checks', async () => {
  const f = await fixture();
  try {
    let ancestorChecks = 0;
    const metadata = {
      check: async (file) => {
        if (file === f.temp && ++ancestorChecks === 1)
          await writeFile(path.join(f.temp, 'sibling'), 'outside trees');
      },
      close: () => {},
    };
    const result = await verifyRuntimeDuplicate(f.args, { metadata });
    assert.equal(result.verifiedDuplicate, true, JSON.stringify(result));
    assert.equal(ancestorChecks, 2);
  } finally {
    await f.cleanup();
  }
});

test('replacement of an outside ancestor is refused when both trees remain unchanged', async () => {
  const f = await fixture();
  try {
    let replaced = false;
    const result = await verifyRuntimeDuplicate(f.args, {
      metadata: { check: async () => {}, close: () => {} },
      inspect: async (file) => {
        const info = await lstat(file, { bigint: true });
        if (!replaced || file !== f.temp) return info;
        return new Proxy(info, {
          get: (object, key) => (key === 'ino' ? object.ino + 1n : Reflect.get(object, key)),
        });
      },
      beforeOpen: async () => {
        replaced = true;
      },
    });
    assert.equal(result.verifiedDuplicate, false);
    assert.equal(result.reason, 'METADATA_CHANGED');
  } finally {
    await f.cleanup();
  }
});
