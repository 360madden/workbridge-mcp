// M3-P8 synthetic-only MCP stdio Node runner; no Sbroenne/vendor GUI process.
// Both this runner and child stub prove exact 20-bit ENV KEY PRESENCE ONLY.
// No values, paths, credentials, command lines or raw MCP text are emitted.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const stub = path.join(repo, 'investigations', 'windows-desktop-automation',
  'prototypes', 'sbroenne-v31-env-oracle-stub.mjs');
const stubSha = 'd6f007e97a456fa2e5676998f9545c1a499e2704060a15bfc2f15da089b35fea';
const nodeExe = 'C:\\Program Files\\nodejs\\node.exe';
const nodeSha = '119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af';
const keys = [
  'PATH', 'SYSTEMROOT', 'TEMP', 'WINDIR',
  'DOTNET_BUNDLE_EXTRACT_BASE_DIR', 'MCP_WINDOWS_TIMEOUT_MS',
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA',
  'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES',
  'PROGRAMFILES(X86)', 'PROGRAMW6432', 'SYSTEMDRIVE', 'USERNAME', 'USERPROFILE'
];
const expectedMask = '111111' + '0'.repeat(14);
class PilotError extends Error { constructor(code) { super(code); this.code = code; } }
function fail(code) { throw new PilotError(code); }
function maskOf(environment) {
  const names = new Set(Object.keys(environment).map(key => key.toUpperCase()));
  return keys.map(key => names.has(key) ? '1' : '0').join('');
}
function output(state, code) {
  if (!/^(success|blocked|unknown)$/.test(state) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code))
    fail('BAD_RESULT_CODE');
  process.stdout.write('RESULT:' + state + ':' + code + ':none\n');
}
function verifyArguments(args) {
  if (args.length !== 3 || args[0] !== 'oracle' || args[1] !== '-' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(args[2] ?? ''))
    fail('ORACLE_ARGS_INVALID');
}
async function verifyFile(file, expected) {
  const st = await fs.lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || !st.size) fail('ORACLE_FILE_UNTRUSTED');
  const actual = createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if (actual !== expected) fail('ORACLE_SOURCE_HASH_MISMATCH');
}
async function waitForParentGo() {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(false), 8000);
    timer.unref();
    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.off('data', gotData);
      process.stdin.pause();
      if (ok) resolve(); else reject(new PilotError('ORACLE_ACK_MISSING'));
    }
    function gotData(chunk) { finish(String(chunk).trim() === 'GO'); }
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', gotData);
    process.stdin.resume();
  });
}
async function waitGone(pid) {
  for (let i = 0; i < 50; i++) {
    try { process.kill(pid, 0); }
    catch (e) { if (e?.code === 'ESRCH') return true; throw e; }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return false;
}
export async function protocolOnly(args) {
  verifyArguments(args);
  await verifyFile(nodeExe, nodeSha);
  await verifyFile(stub, stubSha);
  if (maskOf(process.env) !== expectedMask) fail('ORACLE_RUNNER_ENV_INVALID');
  // Exactly one caller-supplied change beyond SDK default allowed keys.
  // Values are not observed or logged; only a presence mask is considered.
  const bundleBase = process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR;
  const timeout = process.env.MCP_WINDOWS_TIMEOUT_MS;
  if (typeof bundleBase !== 'string' || !bundleBase ||
      timeout !== '10000') fail('ORACLE_REQUIRED_ENV_MISSING');
  let client, transport, pid;
  let state = 'unknown', code = 'ORACLE_UNKNOWN';
  try {
    transport = new StdioClientTransport({
      command: nodeExe, args: [stub], cwd: repo,
      env: {
        DOTNET_BUNDLE_EXTRACT_BASE_DIR: bundleBase,
        MCP_WINDOWS_TIMEOUT_MS: timeout
      }, stderr: 'pipe', maxBufferSize: 65536
    });
    transport.stderr?.on('data', () => {}); // never forward child logs
    client = new Client({ name: 'workbridge-synthetic-env-oracle', version: '1.0.0' },
      { capabilities: {}, versionNegotiation: { mode: 'legacy' } });
    await client.connect(transport);
    pid = transport.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) fail('ORACLE_CHILD_PID_INVALID');
    const listed = await client.listTools();
    if (listed?.tools?.length !== 1 ||
        listed.tools[0]?.name !== 'envmask_' + expectedMask)
      fail('ORACLE_CHILD_ENV_INVALID');
    process.stdout.write('READY:' + pid + '\n');
    await waitForParentGo();
    state = 'success'; code = 'ENV_MASK_VERIFIED';
  } catch (e) {
    code = e instanceof PilotError ? e.code : 'ORACLE_PROTOCOL_EXCEPTION';
    state = 'blocked';
  } finally {
    try {
      if (client) await client.close();
      else if (transport) await transport.close();
    } catch { state = 'unknown'; code = 'ORACLE_CLOSE_FAILED'; }
    if (pid) {
      try {
        if (!(await waitGone(pid))) { state = 'unknown'; code = 'ORACLE_CHILD_NOT_SETTLED'; }
      } catch { state = 'unknown'; code = 'ORACLE_CHILD_EXIT_UNKNOWN'; }
    }
    process.stdin.destroy();
    output(state, code);
    if (state !== 'success') process.exitCode = 2;
  }
}
const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry) {
  protocolOnly(process.argv.slice(2)).catch(() => {
    output('unknown', 'ORACLE_TOP_LEVEL_FAILURE');
    process.exitCode = 2;
  });
}
