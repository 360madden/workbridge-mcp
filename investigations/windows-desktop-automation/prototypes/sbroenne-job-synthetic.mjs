// Synthetic-only descendant for Sbroenne native Job ownership test.
// Never loads MCP, inspects Windows, sends input, or launches a GUI.
import { spawn } from 'node:child_process';
import { once } from 'node:events';

if (process.argv[2] !== 'synthetic' || process.argv[3] !== '-' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(process.argv[4] ?? '')) {
  process.stdout.write('RESULT:blocked:BAD_SYNTHETIC_ARGS:none\n');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
  });
  child.once('error', () => {
    process.stdout.write('RESULT:blocked:SYNTHETIC_CHILD_ERROR:none\n');
    process.exitCode = 2;
  });
  await once(child, 'spawn');
  process.stdout.write('READY:' + child.pid + '\n');

  const go = await Promise.race([
    new Promise((resolve) => {
      process.stdin.setEncoding('utf8');
      process.stdin.once('data', (chunk) => resolve(chunk.trim()));
    }),
    new Promise((resolve) => setTimeout(() => resolve('TIMEOUT'), 10000))
  ]);
  if (go !== 'GO') {
    child.kill();
    process.stdout.write('RESULT:blocked:NO_NATIVE_JOB_ACK:none\n');
    process.exitCode = 2;
  } else {
    const exited = once(child, 'exit');
    child.kill();
    await Promise.race([exited, new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SYNTHETIC_CHILD_EXIT_TIMEOUT')), 3000))]);
    process.stdout.write('RESULT:success:SYNTHETIC_ONLY:none\n');
  }
}
