// Isolated V2 SYNTHETIC-ONLY process-tree fixture; no GUI, MCP, UIA or input.
// Unlike V1, the stdin ACK waiter and timers are closed after GO to permit clean exit.
import { spawn } from 'node:child_process';

function output(state, code) {
  process.stdout.write('RESULT:' + state + ':' + code + ':none\n');
}
if (process.argv[2] !== 'synthetic' || process.argv[3] !== '-' ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(process.argv[4] ?? '')) {
  output('blocked', 'BAD_SYNTHETIC_ARGS');
  process.exitCode = 2;
} else {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore']
  });
  try {
    await new Promise((resolve, reject) => {
      child.once('spawn', resolve);
      child.once('error', reject);
    });
    process.stdout.write('READY:' + child.pid + '\n');

    const go = await new Promise((resolve) => {
      let done = false;
      const timer = setTimeout(() => finish('TIMEOUT'), 8000);
      timer.unref();
      function finish(value) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        process.stdin.off('data', onData);
        process.stdin.pause();
        resolve(value);
      }
      function onData(chunk) { finish(String(chunk).trim()); }
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', onData);
      process.stdin.resume();
    });

    if (go !== 'GO') {
      child.kill();
      output('blocked', 'NO_NATIVE_JOB_ACK');
      process.exitCode = 2;
    } else {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CHILD_EXIT_TIMEOUT')), 3000);
        timer.unref();
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill();
      });
      process.stdin.destroy(); // no dangling resumed stdin or ACK timeout
      output('success', 'SYNTHETIC_ONLY');
    }
  } catch {
    try { child.kill(); } catch {}
    output('blocked', 'SYNTHETIC_CHILD_ERROR');
    process.exitCode = 2;
  }
}
