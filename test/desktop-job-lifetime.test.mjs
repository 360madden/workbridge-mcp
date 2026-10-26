import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const repo = fileURLToPath(new URL('..', import.meta.url));

test(
  'Windows Job Object lifetime counts a surviving grandchild before reporting settlement',
  { skip: process.platform !== 'win32', timeout: 30000 },
  async () => {
    const windows = process.env.SystemRoot ?? 'C:\\Windows';
    const candidates = ['Framework64', 'Framework'].map((arch) =>
      path.join(windows, 'Microsoft.NET', arch, 'v4.0.30319', 'csc.exe'),
    );
    const compiler = (
      await Promise.all(
        candidates.map(async (p) =>
          fs.access(p).then(
            () => p,
            () => null,
          ),
        ),
      )
    ).find(Boolean);
    assert.ok(compiler, 'The same .NET Framework compiler required by the command host must be installed.');
    const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'wb-desktop-job-smoke-'));
    try {
      const executable = path.join(temporary, 'Desktop Job Lifetime Smoke.exe');
      await run(
        compiler,
        [
          '/nologo',
          '/target:exe',
          '/optimize+',
          '/out:' + executable,
          path.join(repo, 'scripts', 'Desktop-JobLifetime.cs'),
          path.join(repo, 'test', 'Desktop-JobLifetime-Smoke.cs'),
        ],
        { windowsHide: true, timeout: 20000, maxBuffer: 8192 },
      );
      const idle = await run(executable, ['idle'], { windowsHide: true, timeout: 10000, maxBuffer: 4096 });
      assert.equal(idle.stdout.trim(), 'IDLE:1');
      const tree = await run(executable, ['tree'], { windowsHide: true, timeout: 10000, maxBuffer: 4096 });
      const parts = /^TREE:(\d+):(\d+):(\d+)$/.exec(tree.stdout.trim());
      assert.ok(parts, 'A positive settlement receipt requires intact host accounting.');
      assert.equal(Number(parts[1]), 1);
      assert.ok(Number(parts[2]) >= 2, 'The Job must see a grandchild after the direct worker exits.');
      assert.equal(Number(parts[3]), 1, 'A settled Job has only its native owner left.');
      const closed = await run(executable, ['close-with-child'], {
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 4096,
      });
      const childPid = /^CHILD:(\d+)$/.exec(closed.stdout.trim());
      assert.ok(childPid, 'The synthetic host must report its spawned child PID.');
      let stillRunning = true;
      for (let attempt = 0; attempt < 40; attempt++) {
        try {
          process.kill(Number(childPid[1]), 0);
        } catch (error) {
          if (error?.code !== 'ESRCH') throw error;
          stillRunning = false;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.equal(stillRunning, false, 'Closing the last native Job handle must terminate its descendant.');
    } finally {
      assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
      await fs.rm(temporary, { recursive: true, force: true });
    }
  },
);
