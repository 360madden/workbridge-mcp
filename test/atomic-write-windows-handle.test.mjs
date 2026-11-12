import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { atomicWrite } from '../dist/changes.js';

const windowsOnly = process.platform !== 'win32';
const originalBytes = '{"revision":1}\n';
const replacementBytes = '{"revision":2}\n';

async function readyWithin(file, child, maxMs = 5000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Lock-holder exited before reporting readiness.');
    try {
      await access(file);
      return;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    await delay(25);
  }
  throw new Error('Lock-holder did not report readiness within five seconds.');
}

function startLockedReader(target, ready, release) {
  const encodedPaths = [target, ready, release].map((value) => Buffer.from(value, 'utf8').toString('base64'));
  const decode = (value) => '[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String("' + value + '"))';
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$target = ' + decode(encodedPaths[0]),
    '$ready = ' + decode(encodedPaths[1]),
    '$release = ' + decode(encodedPaths[2]),
    '$held = [System.IO.FileStream]::new($target, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read)',
    'try {',
    '  [System.IO.File]::WriteAllText($ready, "held")',
    '  $deadline = (Get-Date).AddSeconds(12)',
    '  while (-not [System.IO.File]::Exists($release)) {',
    '    if ((Get-Date) -ge $deadline) { throw "Lock-holder release deadline expired." }',
    '    Start-Sleep -Milliseconds 20',
    '  }',
    '} finally {',
    '  $held.Dispose()',
    '}',
  ].join('\n');
  const shell = path.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const child = spawn(
    shell,
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const settled = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, settled, stderr: () => stderr };
}

async function assertNoTemporaryWrites(folder) {
  const entries = await readdir(folder);
  assert.ok(
    !entries.some((name) => /^\.workbridge-[a-f0-9-]+\.tmp$/i.test(name)),
    'atomicWrite must not retain temporary files after a completed attempt',
  );
}

test(
  'Windows locked state-record destination fails EPERM without replacing bytes, then publishes after handle release',
  { skip: windowsOnly, timeout: 30000 },
  async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'wb-atomic-handle-'));
    const destination = path.join(directory, 'record.json');
    const ready = path.join(directory, 'held.ready');
    const release = path.join(directory, 'held.release');
    let holder;
    try {
      await writeFile(destination, originalBytes);
      holder = startLockedReader(destination, ready, release);
      await readyWithin(ready, holder.child);

      await assert.rejects(
        atomicWrite(destination, replacementBytes),
        (error) => error?.code === 'EPERM',
        'Windows rename-over-existing must report EPERM while the target denies DELETE sharing',
      );
      assert.equal(await readFile(destination, 'utf8'), originalBytes);
      await assertNoTemporaryWrites(directory);

      await writeFile(release, 'release');
      const finished = await Promise.race([
        holder.settled,
        delay(5000).then(() => {
          throw new Error('Lock-holder did not exit after release.');
        }),
      ]);
      assert.deepEqual(finished, { code: 0, signal: null }, holder.stderr());

      await atomicWrite(destination, replacementBytes);
      assert.equal(await readFile(destination, 'utf8'), replacementBytes);
      await assertNoTemporaryWrites(directory);
    } finally {
      if (holder) {
        await writeFile(release, 'release').catch(() => {});
        if (holder.child.exitCode === null) holder.child.kill();
        await Promise.race([holder.settled.catch(() => {}), delay(1500)]);
      }
      assert.ok(directory.startsWith(path.resolve(os.tmpdir()) + path.sep));
      await rm(directory, { recursive: true, force: true });
    }
  },
);
