import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
import path from 'node:path';

const override = process.env.WORKBRIDGE_TEST_DIST;
const changesModule = override
  ? pathToFileURL(path.join(path.resolve(override), 'changes.js')).href
  : new URL('../dist/changes.js', import.meta.url).href;
const { atomicReplaceJournal, digest } = await import(changesModule);
const windowsOnly = process.platform !== 'win32';
const saved = '{"state":"original"}';
const updated = '{"state":"updated"}';
const newer = '{"state":"independently-updated"}';

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-atomic-journal-'));
  const target = path.join(directory, 'record.json');
  await fs.writeFile(target, saved);
  return { directory, target };
}

async function noTemporaries(directory) {
  const entries = await fs.readdir(directory);
  assert.equal(entries.filter((name) => /^\.workbridge-[a-f0-9-]+\.tmp$/i.test(name)).length, 0);
}

function renameFailures(target, shouldFail) {
  const original = fs.rename;
  let calls = 0;
  fs.rename = async function (from, to, ...rest) {
    if (path.resolve(String(to)) === target) {
      calls++;
      if (await shouldFail(calls))
        throw Object.assign(new Error('controlled Windows rename contention'), {
          code: 'EPERM',
          syscall: 'rename',
          errno: -4048,
        });
    }
    return original.call(this, from, to, ...rest);
  };
  syncBuiltinESMExports();
  return {
    calls: () => calls,
    restore() {
      fs.rename = original;
      syncBuiltinESMExports();
    },
  };
}

async function isolatedCase(onRename, verify) {
  const f = await fixture();
  let hook;
  try {
    hook = renameFailures(f.target, (attempt) => onRename(attempt, f));
    return await verify(f, hook);
  } finally {
    hook?.restore();
    assert.ok(f.directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
    await fs.rm(f.directory, { recursive: true, force: true });
  }
}

test(
  'Windows journal replacement retries one transient rename EPERM and publishes exact bytes',
  { skip: windowsOnly, timeout: 10000 },
  async () => {
    await isolatedCase(
      (attempt) => attempt === 1,
      async (f, hook) => {
        await atomicReplaceJournal(f.target, updated, digest(saved), 4096);
        assert.equal(hook.calls(), 2);
        assert.equal(await fs.readFile(f.target, 'utf8'), updated);
        await noTemporaries(f.directory);
      },
    );
  },
);

test(
  'Windows journal retry refuses to overwrite a newer predecessor with JOURNAL_SAVE_CONFLICT',
  { skip: windowsOnly, timeout: 10000 },
  async () => {
    await isolatedCase(
      async (attempt, f) => {
        if (attempt !== 1) return false;
        await fs.writeFile(f.target, newer);
        return true;
      },
      async (f, hook) => {
        await assert.rejects(
          atomicReplaceJournal(f.target, updated, digest(saved), 4096),
          (error) => error?.code === 'JOURNAL_SAVE_CONFLICT',
        );
        assert.equal(hook.calls(), 1);
        assert.equal(await fs.readFile(f.target, 'utf8'), newer);
        await noTemporaries(f.directory);
      },
    );
  },
);

test(
  'Windows persistent journal rename EPERM fails after bounded attempts, retaining old bytes',
  { skip: windowsOnly, timeout: 10000 },
  async () => {
    await isolatedCase(
      () => true,
      async (f, hook) => {
        await assert.rejects(
          atomicReplaceJournal(f.target, updated, digest(saved), 4096),
          (error) => error?.code === 'EPERM' && error?.syscall === 'rename',
        );
        assert.equal(hook.calls(), 10);
        assert.equal(await fs.readFile(f.target, 'utf8'), saved);
        await noTemporaries(f.directory);
      },
    );
  },
);
