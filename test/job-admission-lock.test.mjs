import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Workspace } from '../dist/workspace.js';
import { Jobs } from '../dist/jobs.js';

const windows = process.platform === 'win32';
const shell = path.join(
  process.env.WINDIR ?? 'C:\\Windows',
  'System32',
  'WindowsPowerShell',
  'v1.0',
  'powershell.exe',
);
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-admission-'));
  const state = path.join(root, 'state');
  await fs.mkdir(state);
  const workspace = await Workspace.create(root);
  const jobs = new Jobs(workspace, state);
  t.after(async () => {
    await jobs.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return { root, state, jobs, lockFile: path.join(state, 'updater.lock') };
}

async function heldUpdaterLock(file) {
  const script = `$handle=[IO.File]::Open(${literal(file)},'OpenOrCreate','ReadWrite','None'); try { [Console]::Out.WriteLine('LOCKED'); [Console]::In.ReadLine() | Out-Null } finally { $handle.Dispose() }`;
  const child = spawn(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Updater lock fixture did not start.')), 8000);
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('LOCKED')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (!output.includes('LOCKED')) reject(new Error(`Updater fixture exited early: ${code}`));
    });
  });
  return child;
}

async function stopHolder(child) {
  if (child.exitCode !== null) return;
  child.stdin.end('\n');
  await Promise.race([
    new Promise((resolve) => child.once('close', resolve)),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Updater fixture did not close.')), 5000)),
  ]).finally(() => {
    if (child.exitCode === null) child.kill();
  });
}

test(
  'exclusive updater lock rejects new jobs without a record or execution',
  { skip: !windows },
  async (t) => {
    const f = await fixture(t);
    const holder = await heldUpdaterLock(f.lockFile);
    try {
      await assert.rejects(
        f.jobs.terminal(
          '.',
          process.execPath,
          ['-e', "require('fs').writeFileSync('must-not-run.txt','bad')"],
          30,
          'blocked',
        ),
        (error) => error.code === 'SERVER_UPDATING',
      );
      await assert.rejects(
        fs.access(path.join(f.state, 'jobs', 'blocked.json')),
        (error) => error.code === 'ENOENT',
      );
      await assert.rejects(
        fs.access(path.join(f.root, 'must-not-run.txt')),
        (error) => error.code === 'ENOENT',
      );
      assert.equal((await f.jobs.recent()).capacity.occupied, 0);
    } finally {
      await stopHolder(holder);
    }
  },
);

test('updater cannot obtain exclusive lock during durable job admission', { skip: !windows }, async (t) => {
  const f = await fixture(t);
  const originalSave = f.jobs.save.bind(f.jobs);
  let enter, release;
  const began = new Promise((resolve) => {
    enter = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  f.jobs.save = async (...args) => {
    enter();
    await gate;
    return originalSave(...args);
  };
  const pending = f.jobs.terminal('.', process.execPath, ['-e', 'setInterval(()=>{},1000)'], 30, 'admitting');
  try {
    await began;
    const script = `try { $h=[IO.File]::Open(${literal(f.lockFile)},'OpenOrCreate','ReadWrite','None'); $h.Dispose(); exit 0 } catch { exit 42 }`;
    const probe = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      timeout: 8000,
    });
    assert.equal(probe.status, 42, 'Updater must not acquire its exclusive lock until admission finishes.');
    release();
    const started = await pending;
    assert.equal(started.status, 'running');
    assert.equal((await f.jobs.recent()).capacity.occupied, 1);
  } finally {
    release();
    await pending.catch(() => {});
    await f.jobs.cancel('admitting').catch(() => {});
  }
});
