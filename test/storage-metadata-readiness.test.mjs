import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { metadataReplyClient, windowsMetadata } from '../scripts/preview-storage-retention.mjs';

function fakeWorker({
  readyDelayMs = 0,
  readyText = 'READY',
  replyDelayMs = 0,
  reply = '{"reparse":false}',
} = {}) {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 1);
    child.stdout.end();
    return true;
  };
  child.stdin.on('data', () => {
    if (reply !== null)
      setTimeout(() => {
        if (!child.killed) child.stdout.write(reply + '\n');
      }, replyDelayMs);
  });
  child.stdin.on('end', () => {
    child.emit('exit', 0);
    child.stdout.end();
  });
  if (readyText !== null)
    setTimeout(() => {
      if (!child.killed) child.stdout.write(readyText + '\n');
    }, readyDelayMs);
  return child;
}

test('slow PowerShell initialization has a separate bounded READY deadline', async () => {
  const child = fakeWorker({ readyDelayMs: 70 });
  const metadata = metadataReplyClient(child, { startupTimeoutMs: 300, replyTimeoutMs: 20 });
  try {
    await metadata.check('C:\\synthetic');
    await metadata.check('C:\\synthetic-next');
    assert.equal(child.killed, false);
  } finally {
    metadata.close();
  }
});

test('missing or unexpected READY refuses a metadata result and terminates the worker', async () => {
  for (const opts of [{ readyText: null }, { readyText: 'not-ready' }]) {
    const child = fakeWorker(opts);
    const metadata = metadataReplyClient(child, { startupTimeoutMs: 30, replyTimeoutMs: 20 });
    await assert.rejects(metadata.check('C:\\synthetic'), (e) =>
      ['METADATA_STARTUP_TIMEOUT', 'METADATA_PROVIDER_FAILED'].includes(e.code),
    );
    assert.equal(child.killed, true);
    metadata.close();
  }
});

test('READY does not extend the bounded per-file metadata timeout', async () => {
  const child = fakeWorker({ reply: null });
  const metadata = metadataReplyClient(child, { startupTimeoutMs: 200, replyTimeoutMs: 25 });
  await assert.rejects(metadata.check('C:\\synthetic'), { code: 'METADATA_TIMEOUT' });
  assert.equal(child.killed, true);
  metadata.close();
});

test('reparse detection rejects that path without poisoning subsequent checks', async () => {
  const child = fakeWorker({ reply: '{"reparse":true}' });
  const metadata = metadataReplyClient(child, { startupTimeoutMs: 150, replyTimeoutMs: 100 });
  try {
    await assert.rejects(metadata.check('C:\\link'), { code: 'REPARSE_POINT_SKIPPED' });
    child.stdin.removeAllListeners('data');
    child.stdin.on('data', () => child.stdout.write('{"reparse":false}\n'));
    await metadata.check('C:\\valid');
    assert.equal(child.killed, false);
  } finally {
    metadata.close();
  }
});

test(
  'real Windows read-only metadata worker completes READY and a file check',
  { skip: process.platform !== 'win32', timeout: 20000 },
  async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wb-metadata-ready-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const metadata = windowsMetadata();
    t.after(() => metadata.close());
    await metadata.check(root);
  },
);
