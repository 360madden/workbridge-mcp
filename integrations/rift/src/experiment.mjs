import { spawn } from 'node:child_process';
import { ResearchError } from './identity.mjs';
import { parseRecords } from './records.mjs';

const MAX_STDOUT = 4 * 1024 * 1024;
const MAX_STDERR = 16 * 1024;

export async function runRPTAnalyzer({ python, scriptPath, trackPath, timeoutMs = 20_000 }) {
  if (!python || !scriptPath || !trackPath) {
    throw new ResearchError('MISSING_ANALYZER', 'Python, existing RPT script and track path are required.');
  }
  const child = spawn(python, ['-B', scriptPath, trackPath], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let overflow = false;
  let timedOut = false;
  child.stdout.on('data', (chunk) => {
    stdoutBytes += chunk.length;
    if (stdoutBytes <= MAX_STDOUT) stdout.push(chunk);
    else {
      overflow = true;
      child.kill();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderrBytes += chunk.length;
    if (stderrBytes <= MAX_STDERR) stderr.push(chunk);
    else {
      overflow = true;
      child.kill();
    }
  });
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  timeout.unref();
  let exitCode;
  try {
    exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => {
        if (signal && !timedOut && !overflow) reject(new Error('Analyzer terminated by ' + signal));
        else resolve(code);
      });
    });
  } catch (error) {
    throw new ResearchError('ANALYZER_LAUNCH', 'RPT offline analyzer could not run: ' + error.message);
  } finally {
    clearTimeout(timeout);
  }
  if (timedOut) throw new ResearchError('ANALYZER_TIMEOUT', 'RPT offline analyzer exceeded its deadline.');
  if (overflow) throw new ResearchError('ANALYZER_OUTPUT_LIMIT', 'RPT analyzer exceeded output limits.');
  if (exitCode !== 0) {
    const excerpt = Buffer.concat(stderr).toString('utf8').slice(0, 500);
    throw new ResearchError('ANALYZER_FAILED', 'RPT analyzer exited ' + exitCode + ': ' + excerpt);
  }
  const text = Buffer.concat(stdout);
  const classifications = parseRecords(text, 'RPT analysis');
  return { classifications, stdout: text, exitCode, stderr: Buffer.concat(stderr) };
}
