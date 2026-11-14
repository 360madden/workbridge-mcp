import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createPurgeProvider } from '../scripts/storage-retention-purge-provider.mjs';

function fixture(override = {}) {
  const ctx = {
    installRoot: 'C:\\fixture',
    operationId: 'gc1',
    plan: { updaterOperationId: 'up1', kind: 'candidate' },
    maintenanceConfirmed: true,
    confirmPermanentlyDelete: 'gc1',
    expectedPurgeSha256: 'a'.repeat(64),
    expectedManifestSha256: 'b'.repeat(64),
    expectedHelperSha256: 'c'.repeat(64),
    ...override,
  };
  const calls = [];
  let spawnCount = 0,
    child;
  const spawn = (exe, args, opts) => {
    spawnCount++;
    calls.push({ exe, args, opts });
    child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.emit('close', 1);
      return true;
    };
    let pending = '';
    child.stdin.on('data', (chunk) => {
      pending += chunk.toString();
      let i;
      while ((i = pending.indexOf('\n')) >= 0) {
        const command = JSON.parse(pending.slice(0, i));
        pending = pending.slice(i + 1);
        calls.push(command);
        if (command.command === 'readJournals')
          child.stdout.write(
            JSON.stringify({ status: 'ok', files: { 'purge-manifest.json': '{"x":"é"}\n' } }) + '\n',
          );
        else child.stdout.write(JSON.stringify({ status: 'ok', command: command.command }) + '\n');
      }
    });
    child.stdin.on('end', () => child.emit('close', 0));
    queueMicrotask(() =>
      child.stdout.write(
        JSON.stringify({
          status: 'ready',
          operationId: 'gc1',
          manifestSha256: 'b'.repeat(64),
          entryCount: 1,
        }) + '\n',
      ),
    );
    return child;
  };
  return {
    ctx,
    calls,
    get spawnCount() {
      return spawnCount;
    },
    get child() {
      return child;
    },
    provider: createPurgeProvider({
      revalidateSafety: async () => ({}),
      testDependencies: { spawn, replyMs: 50, closeMs: 50, killMs: 50 },
    }),
  };
}
test('forwards fixed commands and preserves exact journal UTF-8 bytes', async () => {
  const f = fixture();
  await f.provider.withPurgeLease(f.ctx, async (guard) => {
    const files = await guard.readJournals();
    assert.deepEqual(files['purge-manifest.json'], Buffer.from('{"x":"é"}\n'));
    await guard.publish('intent', { start: 0, end: 1 });
    await guard.inspectRemaining({ committedPrefix: 0, inflightEnd: 1 });
    await guard.deleteBatch({ start: 0, end: 1 });
  });
  assert.deepEqual(f.calls.slice(1), [
    { command: 'readJournals' },
    { command: 'publish', kind: 'intent', record: { start: 0, end: 1 } },
    { command: 'inspectRemaining', committedPrefix: 0, inflightEnd: 1 },
    { command: 'deleteBatch', start: 0, end: 1 },
  ]);
  const launch = f.calls[0];
  assert.ok(launch.exe.endsWith('powershell.exe'));
  assert.equal(launch.opts.env.WB_PURGE_HELPER_SHA, 'c'.repeat(64));
  const source = Buffer.from(launch.args.at(-1), 'base64').toString('utf16le');
  assert.match(source, /FileShare\]::Read/);
  assert.match(source, /ComputeHash/);
  assert.match(source, /ScriptBlock\]::Create/);
});
test('explicit confirmations, immutable hashes and identity are required before spawn', async () => {
  for (const patch of [
    { maintenanceConfirmed: false },
    { confirmPermanentlyDelete: 'x' },
    { expectedHelperSha256: 'bad' },
    { expectedManifestSha256: 'bad' },
    { expectedPurgeSha256: 'bad' },
    { operationId: '../x' },
  ]) {
    const f = fixture(patch);
    await assert.rejects(
      f.provider.withPurgeLease(f.ctx, async () => {}),
      /PURGE_PROVIDER_CONTEXT_INVALID/,
    );
    assert.equal(f.spawnCount, 0);
  }
});
test('rejects unrecognized publication and closes after callback failure', async () => {
  const f = fixture();
  await assert.rejects(
    f.provider.withPurgeLease(f.ctx, async (guard) => guard.publish('other', {})),
    /PURGE_PUBLISH_INVALID/,
  );
  assert.equal(f.calls.length, 1);
});
test('rejects missing native capability on unsupported platform without test injection', async () => {
  if (process.platform !== 'win32') {
    const f = fixture();
    await assert.rejects(
      createPurgeProvider().withPurgeLease(f.ctx, async () => {}),
      /WINDOWS_PURGE_REQUIRED/,
    );
  }
});

test('rejects malformed UTF-8 from the helper', async () => {
  const f = fixture();
  const spawn = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {
      child.emit('close', 0);
      return true;
    };
    child.stdin.on('end', () => child.emit('close', 0));
    queueMicrotask(() => child.stdout.write(Buffer.from([0xff, 0x0a])));
    return child;
  };
  const provider = createPurgeProvider({ testDependencies: { spawn, replyMs: 50, closeMs: 50 } });
  await assert.rejects(
    provider.withPurgeLease(f.ctx, async () => {}),
    /PURGE_HELPER_UTF8_INVALID/,
  );
});
