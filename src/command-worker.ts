import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

// An internal worker, not a public shell API. The Windows host keeps a Job
// Object open around this worker and all command descendants. Exit on the
// root command's exit, even if descendants keep inherited output pipes open.
const input = JSON.parse(readFileSync(0, 'utf8')) as {
  executable: string;
  args: string[];
  resultFile: string;
  timeoutSeconds: number;
};
let finished = false;
function finish(exitCode: number | null, errorCode?: string, timedOut = false) {
  if (finished) return;
  finished = true;
  try {
    writeFileSync(input.resultFile, JSON.stringify({ exitCode, errorCode, timedOut }));
  } catch {
    console.error('Command result could not be recorded.');
    process.exit(126);
  }
  process.exit(errorCode || timedOut ? 1 : (exitCode ?? 1));
}
const timer = setTimeout(() => finish(null, undefined, true), input.timeoutSeconds * 1000);
timer.unref();
try {
  const child = spawn(input.executable, input.args, {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  child.once('error', (error: NodeJS.ErrnoException) => finish(null, error.code ?? 'SPAWN_ERROR'));
  child.once('exit', (code, signal) => finish(code, signal ? `SIGNAL_${signal}` : undefined));
} catch (error) {
  finish(null, (error as NodeJS.ErrnoException).code ?? 'SPAWN_ERROR');
}
