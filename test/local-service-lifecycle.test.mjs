import { test } from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, mkdir, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/server';

const fixturePrefix = path.join(os.tmpdir(), 'workbridge-local-lifecycle-');
const createServer = () => new McpServer({ name: 'local-service-lifecycle-test', version: '1' });

async function bounded(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds}ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture() {
  const directory = await mkdtemp(fixturePrefix);
  const root = path.join(directory, 'Workspace');
  const state = path.join(directory, 'State');
  await mkdir(root);
  await mkdir(state);
  return { directory, root, state };
}

async function removeFixture(directory) {
  assert.ok(directory.startsWith(fixturePrefix), `refusing to remove unexpected fixture: ${directory}`);
  await rm(directory, { recursive: true, force: true });
}

function helperAction(args) {
  if (!Array.isArray(args)) return undefined;
  const index = args.indexOf('-Action');
  return index >= 0 ? args[index + 1] : undefined;
}

test(
  'guardian exit during descriptor protection aborts startup without publishing an endpoint',
  { skip: process.platform !== 'win32', timeout: 60_000 },
  async () => {
    const { directory, root, state } = await fixture();
    const originalSpawn = childProcess.spawn;
    const children = new Map();
    let guardian;
    let fatalCount = 0;
    childProcess.spawn = function (...args) {
      const child = originalSpawn(...args);
      const closed = new Promise((resolve) => child.once('close', resolve));
      children.set(child, closed);
      const action = helperAction(args[1]);
      if (action === 'Own') guardian = child;
      if (action === 'Protect') {
        assert.ok(guardian, 'the owner guardian must exist before descriptor protection');
        assert.equal(guardian.kill(), true, 'the disposable owner guardian should still be running');
      }
      return child;
    };
    syncBuiltinESMExports();

    let recovered;
    try {
      const { startLocalService } = await import('../dist/local-service.js');
      await assert.rejects(
        bounded(
          startLocalService({
            state,
            root,
            version: 'lifecycle-test',
            createServer,
            onFatal: () => fatalCount++,
          }),
          'startup after guardian failure',
        ),
        /guardian exited unexpectedly/i,
      );
      assert.equal(fatalCount, 1);
      await assert.rejects(
        lstat(path.join(state, 'ipc', 'endpoint.dpapi')),
        (error) => error.code === 'ENOENT',
      );

      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      recovered = await bounded(
        startLocalService({ state, root, version: 'lifecycle-test', createServer }),
        'owner recovery',
      );
      assert.equal(recovered.status.state.toLowerCase(), state.toLowerCase());
    } finally {
      childProcess.spawn = originalSpawn;
      syncBuiltinESMExports();
      if (recovered) await bounded(recovered.close(), 'recovered owner close').catch(() => {});
      for (const child of children.keys())
        if (child.exitCode === null && child.signalCode === null) child.kill();
      await Promise.allSettled(children.values());
      await removeFixture(directory);
    }
  },
);

test(
  'stopAccepting removes the endpoint but retains exclusive ownership until close',
  { skip: process.platform !== 'win32', timeout: 60_000 },
  async () => {
    const { directory, root, state } = await fixture();
    const { startLocalService } = await import('../dist/local-service.js');
    let owner;
    let replacement;
    try {
      owner = await bounded(
        startLocalService({ state, root, version: 'lifecycle-test', createServer }),
        'first owner startup',
      );
      await bounded(owner.stopAccepting(), 'stopAccepting');
      await assert.rejects(
        lstat(path.join(state, 'ipc', 'endpoint.dpapi')),
        (error) => error.code === 'ENOENT',
      );

      await assert.rejects(
        startLocalService({ state, root, version: 'lifecycle-test', createServer }),
        /Cannot acquire the local-service owner lock/i,
      );

      await bounded(owner.close(), 'first owner close');
      owner = undefined;
      replacement = await bounded(
        startLocalService({ state, root, version: 'lifecycle-test', createServer }),
        'replacement owner startup',
      );
      assert.equal(replacement.status.state.toLowerCase(), state.toLowerCase());
      assert.equal(replacement.status.root.toLowerCase(), root.toLowerCase());
    } finally {
      if (replacement) await bounded(replacement.close(), 'replacement owner close').catch(() => {});
      if (owner) await bounded(owner.close(), 'first owner cleanup').catch(() => {});
      await removeFixture(directory);
    }
  },
);
