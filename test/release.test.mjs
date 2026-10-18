import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('release probe bounds an unresponsive server and terminates its child', async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), 'workbridge-probe-test-'));
  let child;
  let serverPid;
  try {
    await mkdir(path.join(fixture, 'dist'));
    await writeFile(
      path.join(fixture, 'package.json'),
      JSON.stringify({ type: 'module', version: 'fixture' }),
    );
    await writeFile(
      path.join(fixture, 'dist/server.js'),
      "import { writeFileSync } from 'node:fs'; writeFileSync('child.pid', String(process.pid)); setInterval(() => {}, 1000);",
    );
    const started = Date.now();
    child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../scripts/release-acceptance.mjs', import.meta.url))],
      {
        cwd: fixture,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(exit, 1);
    assert.match(stderr, /20-second deadline/);
    assert.ok(Date.now() - started < 30_000);
    serverPid = Number(await readFile(path.join(fixture, 'child.pid'), 'utf8'));
    let alive = true;
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        process.kill(serverPid, 0);
      } catch {
        alive = false;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(alive, false, 'timed-out probe server must not remain running');
  } finally {
    if (child && child.exitCode === null) child.kill();
    if (serverPid) {
      try {
        process.kill(serverPid);
      } catch {
        /* Already exited. */
      }
    }
    await rm(fixture, { recursive: true, force: true });
  }
});
