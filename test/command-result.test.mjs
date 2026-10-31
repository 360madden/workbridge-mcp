import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { commandResultBytes, readCommandResult, serializeCommandResult } from '../dist/command-result.js';
let suite,
  sequence = 0;
before(async () => {
  suite = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-result-reader-'));
});
after(async () => {
  assert.ok(suite.startsWith(path.resolve(os.tmpdir()) + path.sep));
  await fs.rm(suite, { recursive: true, force: true });
});
async function fixture() {
  const dir = path.join(suite, String(sequence++));
  await fs.mkdir(dir);
  const identity = { jobId: 'sample', invocationId: randomUUID() },
    file = path.join(dir, 'sample.result.json'),
    text = serializeCommandResult(identity, 7);
  await fs.writeFile(file, text);
  return { dir, file, identity, text };
}
const invalid = (e) => e.code === 'COMMAND_RESULT_INVALID';

test('result schema round-trips successful, failed, signed Windows, timeout and spawn-error outcomes', async () => {
  const f = await fixture();
  for (const [exit, error, timed] of [
    [0, undefined, false],
    [7, undefined, false],
    [-1073741819, undefined, false],
    [4294967295, undefined, false],
    [null, 'ENOENT', false],
    [null, undefined, true],
  ]) {
    await fs.writeFile(f.file, serializeCommandResult(f.identity, exit, error, timed));
    const r = await readCommandResult(f.file, f.identity);
    assert.equal(r.exitCode, exit);
    assert.equal(r.errorCode, error);
    assert.equal(r.timedOut, timed);
    assert.equal(r.invocationId, f.identity.invocationId);
  }
});

test('exact byte bound is accepted and excess is rejected before opening the file', async () => {
  const f = await fixture();
  assert.equal(commandResultBytes, 4096);
  await fs.writeFile(f.file, f.text + ' '.repeat(commandResultBytes - Buffer.byteLength(f.text)));
  assert.equal((await readCommandResult(f.file, f.identity)).exitCode, 7);
  await fs.appendFile(f.file, ' ');
  const original = fs.open;
  let opened = false;
  fs.open = async (...args) => {
    opened = true;
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(readCommandResult(f.file, f.identity), invalid);
    assert.equal(opened, false);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
});

test('short low-level reads are consumed completely within the bounded allocation', async () => {
  const f = await fixture(),
    original = fs.open;
  let calls = 0,
    largest = 0;
  fs.open = async function (...args) {
    const h = await original(...args),
      read = h.read.bind(h);
    h.read = async function (buffer, offset, length, position) {
      calls++;
      largest = Math.max(largest, buffer.length);
      return read(buffer, offset, Math.min(length, 3), position);
    };
    return h;
  };
  syncBuiltinESMExports();
  try {
    assert.equal((await readCommandResult(f.file, f.identity)).exitCode, 7);
    assert.ok(calls > 1);
    assert.ok(largest <= commandResultBytes + 1);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
});

for (const mode of ['truncate', 'grow', 'replace'])
  test(mode + ' during a result read is rejected', async () => {
    const f = await fixture(),
      original = fs.open;
    let changed = false;
    fs.open = async function (...args) {
      const h = await original(...args),
        read = h.read.bind(h);
      h.read = async function (...readArgs) {
        const r = await read(...readArgs);
        if (!changed) {
          changed = true;
          if (mode === 'truncate') await fs.truncate(f.file, 2);
          else if (mode === 'grow') await fs.appendFile(f.file, ' ');
          else {
            await fs.rename(f.file, f.file + '.old');
            await fs.writeFile(f.file, f.text);
          }
        }
        return r;
      };
      return h;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(readCommandResult(f.file, f.identity), invalid);
      assert.equal(changed, true);
    } finally {
      fs.open = original;
      syncBuiltinESMExports();
    }
  });

test('replacement between path inspection and opening is refused', async () => {
  const f = await fixture(),
    original = fs.open;
  fs.open = async function (...args) {
    await fs.rename(f.file, f.file + '.old');
    await fs.writeFile(f.file, f.text);
    return original(...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(readCommandResult(f.file, f.identity), invalid);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
});

test('linked parent is rejected without opening or modifying the target result', async () => {
  const f = await fixture(),
    link = path.join(suite, 'alias-' + sequence++);
  await fs.symlink(f.dir, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(readCommandResult(path.join(link, path.basename(f.file)), f.identity), invalid);
  assert.equal(await fs.readFile(f.file, 'utf8'), f.text);
});

test('strict fields, types, identity, encoding and outcome consistency are checked', async () => {
  const f = await fixture(),
    base = JSON.parse(f.text);
  const cases = [
    { ...base, errorCode: 'x'.repeat(201) },
    { ...base, errorCode: '' },
    { ...base, timedOut: 'false' },
    { ...base, exitCode: '0' },
    { ...base, exitCode: 0.5 },
    { ...base, exitCode: Number.MAX_SAFE_INTEGER + 1 },
    { ...base, exitCode: null },
    { ...base, errorCode: 'EIO' },
    { ...base, extra: 1 },
    { ...base, invocationId: randomUUID() },
    { ...base, jobId: 'different' },
    { ...base, schemaVersion: 2 },
  ];
  for (const r of cases) {
    await fs.writeFile(f.file, JSON.stringify(r));
    await assert.rejects(readCommandResult(f.file, f.identity), invalid);
  }
  await fs.writeFile(
    f.file,
    Buffer.concat([Buffer.from(f.text.slice(0, -1)), Buffer.from([255]), Buffer.from('}')]),
  );
  await assert.rejects(readCommandResult(f.file, f.identity), invalid);
  await fs.writeFile(f.file, '');
  await assert.rejects(readCommandResult(f.file, f.identity), invalid);
});

test('missing initial result is distinct from a read-denied result', async () => {
  const f = await fixture();
  await fs.unlink(f.file);
  await assert.rejects(readCommandResult(f.file, f.identity), (e) => e.code === 'COMMAND_RESULT_MISSING');
  await fs.writeFile(f.file, f.text);
  const original = fs.open;
  fs.open = async () => {
    throw Object.assign(new Error('private denied'), { code: 'EACCES' });
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(readCommandResult(f.file, f.identity), invalid);
  } finally {
    fs.open = original;
    syncBuiltinESMExports();
  }
});
