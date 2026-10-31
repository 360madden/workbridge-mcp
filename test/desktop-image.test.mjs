import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
// Native Node >=24 type stripping keeps this worker's tests independent of the shared dist build.
import { loadDesktopImage } from '../src/desktop-image.ts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/bH8AAAAASUVORK5CYII=',
  'base64',
);
const maxBytes = 8 * 1024 * 1024;
const invalid = (error) => error.code === 'DESKTOP_IMAGE_INVALID';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, bytes = png) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-desktop-image-'));
  t.after(async () => {
    assert.ok(base.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(base, { recursive: true, force: true });
  });
  const evidenceRoot = path.join(base, '.tools', 'desktop-evidence');
  await fs.mkdir(evidenceRoot, { recursive: true });
  const requestId = 'gui006_image_001';
  const imagePath = path.join(evidenceRoot, `capture-${requestId}.png`);
  await fs.writeFile(imagePath, bytes, { flag: 'wx' });
  const receipt = {
    ok: true,
    requestId,
    imagePath,
    sha256: sha(bytes),
    width: 1,
    height: 1,
    sizeBytes: bytes.length,
  };
  return { base, evidenceRoot, receipt, load: (r = receipt) => loadDesktopImage(r, { evidenceRoot }) };
}

async function patchFs(t, name, replace) {
  const original = fs[name];
  fs[name] = replace(original);
  syncBuiltinESMExports();
  t.after(() => {
    fs[name] = original;
    syncBuiltinESMExports();
  });
}

test('GUI-006 image returns verified bounded PNG data for desktop and aggregate VM receipts', async (t) => {
  const f = await fixture(t);
  const expected = {
    mimeType: 'image/png',
    data: png.toString('base64'),
    sha256: sha(png),
    width: 1,
    height: 1,
    sizeBytes: png.length,
    requestId: f.receipt.requestId,
  };
  assert.deepEqual(await f.load(), expected);
  assert.deepEqual(
    await f.load({
      ...f.receipt,
      sha256: f.receipt.sha256.toUpperCase(),
      guestInputInjected: false,
      originalWindowState: 'minimized',
      finalWindowState: 'minimized',
      stateRecovery: 'minimized',
      replayed: true,
    }),
    expected,
  );
  assert.deepEqual(Buffer.from(expected.data, 'base64'), png);
});

test('GUI-006 default root is fixed to repository evidence, independent of receipt options', async (t) => {
  const f = await fixture(t);
  await assert.rejects(loadDesktopImage({ ...f.receipt, evidenceRoot: f.evidenceRoot }), invalid);
});

test('GUI-006 receipt requires successful, typed, bounded and consistent metadata', async (t) => {
  const f = await fixture(t);
  const cases = [
    null,
    [],
    'receipt',
    {},
    ...[
      ['ok', false],
      ['ok', undefined],
      ['requestId', '../image'],
      ['requestId', '_gui006_'],
      ['requestId', 'short'],
      ['requestId', 'a'.repeat(65)],
      ['imagePath', null],
      ['sha256', 'z'.repeat(64)],
      ['sha256', 1],
      ['sha256', '0'.repeat(64)],
      ['width', '1'],
      ['width', 0],
      ['width', 10001],
      ['width', 1.5],
      ['width', NaN],
      ['height', -1],
      ['height', Infinity],
      ['height', 10001],
      ['height', 2],
      ['sizeBytes', png.length + 1],
      ['sizeBytes', maxBytes + 1],
      ['sizeBytes', 0],
      ['sizeBytes', '68'],
      ['mimeType', 'image/jpeg'],
    ].map(([key, value]) => ({ ...f.receipt, [key]: value })),
  ];
  for (const receipt of cases) await assert.rejects(f.load(receipt), invalid);
});

test('GUI-006 exact capture path rejects traversal, sibling prefixes, URLs and path spoofing', async (t) => {
  const f = await fixture(t);
  const name = path.basename(f.receipt.imagePath);
  for (const imagePath of [
    name,
    `file://${f.receipt.imagePath}`,
    path.join(f.base, name),
    path.join(f.evidenceRoot + '-other', name),
    path.join(f.evidenceRoot, 'capture-other001.png'),
    f.evidenceRoot + path.sep + '..' + path.sep + 'desktop-evidence' + path.sep + name,
    f.evidenceRoot + path.sep + '.' + path.sep + name,
    f.receipt.imagePath + ':stream',
    f.receipt.imagePath + '.png',
    f.receipt.imagePath + '\0',
  ]) {
    await assert.rejects(f.load({ ...f.receipt, imagePath }), invalid);
  }
  await assert.rejects(f.load({ ...f.receipt, requestId: 'another_id' }), invalid);
});

test('GUI-006 tampered bytes are rejected even at the original size', async (t) => {
  const f = await fixture(t);
  const tampered = Buffer.from(png);
  tampered[42] ^= 1;
  await fs.writeFile(f.receipt.imagePath, tampered);
  await assert.rejects(f.load(), invalid);
});

test('GUI-006 PNG dimensions must be valid and agree with the receipt', async (t) => {
  const f = await fixture(t);
  for (const [offset, value] of [
    [16, 0],
    [20, 0],
    [16, 10001],
    [20, 0xffffffff],
    [16, 2],
  ]) {
    const bytes = Buffer.from(png);
    bytes.writeUInt32BE(value, offset);
    await fs.writeFile(f.receipt.imagePath, bytes);
    await assert.rejects(f.load({ ...f.receipt, sha256: sha(bytes) }), invalid);
  }
});

test('GUI-006 rejects malformed headers, truncated chunks and false IEND markers', async (t) => {
  const f = await fixture(t);
  const signature = Buffer.from(png);
  signature[0] = 0;
  const headerLength = Buffer.from(png);
  headerLength.writeUInt32BE(12, 8);
  const headerType = Buffer.from(png);
  headerType.write('JUNK', 12);
  const fakeEnd = Buffer.from(png);
  fakeEnd.write('IEND', 42); // Marker in IDAT payload, not a chunk boundary.
  fakeEnd.write('JUNK', fakeEnd.length - 8);
  const chunkLength = Buffer.from(png);
  chunkLength.writeUInt32BE(0xffffffff, 33);
  const endLength = Buffer.from(png);
  endLength.writeUInt32BE(1, endLength.length - 12);
  const endCrc = Buffer.from(png);
  endCrc[endCrc.length - 1] ^= 1;
  for (const bytes of [
    signature,
    headerLength,
    headerType,
    fakeEnd,
    chunkLength,
    endLength,
    endCrc,
    png.subarray(0, png.length - 12),
    png.subarray(0, png.length - 1),
    Buffer.concat([png, Buffer.from('trailer')]),
  ]) {
    await fs.writeFile(f.receipt.imagePath, bytes);
    await assert.rejects(f.load({ ...f.receipt, sha256: sha(bytes), sizeBytes: bytes.length }), invalid);
  }
});

test('GUI-006 file bounds are checked before opening, even when a receipt lies about size', async (t) => {
  const f = await fixture(t);
  await fs.truncate(f.receipt.imagePath, maxBytes + 1);
  let opened = false;
  await patchFs(t, 'open', (original) => async (...args) => {
    opened = true;
    return original(...args);
  });
  await assert.rejects(f.load(), invalid);
  assert.equal(opened, false);
  await fs.truncate(f.receipt.imagePath, 44);
  await assert.rejects(f.load(), invalid);
  assert.equal(opened, false);
});

test('GUI-006 accepts exactly 8 MiB and bounds the encoded result', async (t) => {
  // A synthetic ancillary chunk exercises transport bounds without creating a desktop capture.
  const extra = Buffer.alloc(maxBytes - png.length);
  extra.writeUInt32BE(extra.length - 12, 0);
  extra.write('tEXt', 4);
  const bytes = Buffer.concat([png.subarray(0, -12), extra, png.subarray(-12)]);
  const f = await fixture(t, bytes);
  const result = await f.load();
  assert.equal(result.sizeBytes, maxBytes);
  assert.equal(result.data.length, 4 * Math.ceil(maxBytes / 3));
  assert.equal(sha(Buffer.from(result.data, 'base64')), f.receipt.sha256);
});

test('GUI-006 rejects an evidence directory junction/symlink', async (t) => {
  const f = await fixture(t);
  const linkedRoot = path.join(f.base, 'evidence-link');
  await fs.symlink(f.evidenceRoot, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(
    loadDesktopImage(
      { ...f.receipt, imagePath: path.join(linkedRoot, path.basename(f.receipt.imagePath)) },
      { evidenceRoot: linkedRoot },
    ),
    invalid,
  );
  assert.deepEqual(await fs.readFile(f.receipt.imagePath), png);
});

test('GUI-006 rejects a junction/symlink above the evidence directory', async (t) => {
  const f = await fixture(t);
  const alias = path.join(f.base, 'tools-link');
  await fs.symlink(path.dirname(f.evidenceRoot), alias, process.platform === 'win32' ? 'junction' : 'dir');
  const root = path.join(alias, 'desktop-evidence');
  await assert.rejects(
    loadDesktopImage(
      { ...f.receipt, imagePath: path.join(root, path.basename(f.receipt.imagePath)) },
      { evidenceRoot: root },
    ),
    invalid,
  );
});

test('GUI-006 rejects hard-linked evidence', async (t) => {
  const f = await fixture(t);
  await fs.link(f.receipt.imagePath, path.join(f.base, 'other.png'));
  await assert.rejects(f.load(), invalid);
});

test('GUI-006 rejects file symlinks without reading their target', async (t) => {
  const f = await fixture(t);
  const target = path.join(f.base, 'target.png');
  await fs.rename(f.receipt.imagePath, target);
  try {
    await fs.symlink(target, f.receipt.imagePath, 'file');
  } catch (error) {
    if (process.platform === 'win32' && error.code === 'EPERM') {
      t.skip('Windows file symlink privilege unavailable; directory junction coverage still runs.');
      return;
    }
    throw error;
  }
  await assert.rejects(f.load(), invalid);
  assert.deepEqual(await fs.readFile(target), png);
});

test('GUI-006 rejects missing evidence and directories with a sanitized error', async (t) => {
  const f = await fixture(t);
  await fs.unlink(f.receipt.imagePath);
  await assert.rejects(f.load(), (error) => invalid(error) && !error.message.includes(f.base));
  await fs.mkdir(f.receipt.imagePath);
  await assert.rejects(f.load(), invalid);
});

test('GUI-006 handles short reads and bounds allocation to the observed file size plus one', async (t) => {
  const f = await fixture(t);
  let reads = 0;
  await patchFs(t, 'open', (original) => async (...args) => {
    const handle = await original(...args);
    const read = handle.read.bind(handle);
    handle.read = async (buffer, offset, length, position) => {
      reads++;
      assert.equal(buffer.length, png.length + 1);
      return read(buffer, offset, Math.min(length, 3), position);
    };
    return handle;
  });
  assert.equal((await f.load()).data, png.toString('base64'));
  assert.ok(reads > 1);
});

for (const mode of ['grow', 'truncate', 'replace']) {
  test(`GUI-006 rejects evidence that ${mode}s during reading`, async (t) => {
    const f = await fixture(t);
    let changed = false;
    await patchFs(t, 'open', (original) => async (...args) => {
      const handle = await original(...args);
      const read = handle.read.bind(handle);
      handle.read = async (...readArgs) => {
        const result = await read(...readArgs);
        if (!changed) {
          changed = true;
          if (mode === 'grow') await fs.appendFile(f.receipt.imagePath, 'x');
          else if (mode === 'truncate') await fs.truncate(f.receipt.imagePath, 44);
          else {
            await fs.rename(f.receipt.imagePath, f.receipt.imagePath + '.old');
            await fs.writeFile(f.receipt.imagePath, png);
          }
        }
        return result;
      };
      return handle;
    });
    await assert.rejects(f.load(), invalid);
    assert.equal(changed, true);
  });
}

test('GUI-006 rejects replacement between file inspection and open', async (t) => {
  const f = await fixture(t);
  await patchFs(t, 'open', (original) => async (...args) => {
    await fs.rename(f.receipt.imagePath, f.receipt.imagePath + '.old');
    await fs.writeFile(f.receipt.imagePath, png);
    return original(...args);
  });
  await assert.rejects(f.load(), invalid);
});
