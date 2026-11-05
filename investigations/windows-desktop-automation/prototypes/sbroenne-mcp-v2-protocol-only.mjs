// M3-P6 investigation-only Sbroenne MCP stdio metadata test; ZERO UIA calls.
// The native V2 Job supervisor launches this exact SHA-pinned source suspended.
// Even after GO, only closes the metadata connection: no ui_snapshot invocation.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const publish = path.join(repo, 'investigations', 'windows-desktop-automation', 'temp', 'sbroenne-stdio-publish');
const expected = Object.freeze({
  'Sbroenne.WindowsMcp.exe': 'c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9',
  'Sbroenne.WindowsMcp.dll': '99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900',
  'Sbroenne.WindowsMcp.runtimeconfig.json': '6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39'
});
class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new PilotError(code); }
function output(state, code) {
  if (!/^(success|blocked|unknown)$/.test(state) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code))
    fail('INVALID_RESULT_CODE');
  process.stdout.write('RESULT:' + state + ':' + code + ':none\n');
}
async function verifyPinned() {
  for (const [name, sha] of Object.entries(expected)) {
    const file = path.join(publish, name);
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) fail('UNTRUSTED_SERVER_FILE');
    if (createHash('sha256').update(await fs.readFile(file)).digest('hex') !== sha)
      fail('SERVER_HASH_MISMATCH');
  }
}
function verifyArguments(args) {
  const [mode, manifest, sampleId] = args;
  if (args.length !== 3 || mode !== 'protocol' || manifest !== '-' ||
      typeof sampleId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(sampleId)) fail('INVALID_ARGUMENTS');
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
      if (ok) resolve(); else reject(new PilotError('NATIVE_ACK_MISSING'));
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
  await verifyPinned();
  let client, transport, pid;
  let resultState = 'unknown', resultCode = 'MCP_PROTOCOL_UNKNOWN';
  try {
    transport = new StdioClientTransport({
      command: path.join(publish, 'Sbroenne.WindowsMcp.exe'),
      args: ['--tools', 'ui_snapshot'], cwd: repo,
      env: { MCP_WINDOWS_TIMEOUT_MS: '10000' }, stderr: 'pipe', maxBufferSize: 300000
    });
    transport.stderr?.on('data', () => {}); // Drain and discard all private provider stderr.
    client = new Client({ name: 'workbridge-sbroenne-v2-protocol-only', version: '1.0.0' },
      { capabilities: {}, versionNegotiation: { mode: 'legacy' } });
    await client.connect(transport);
    pid = transport.pid;
    if (!Number.isSafeInteger(pid) || pid <= 0) fail('SERVER_PID_INVALID');
    const listed = await client.listTools();
    if (listed?.tools?.length !== 1 || listed.tools[0]?.name !== 'ui_snapshot')
      fail('SERVER_TOOL_ALLOWLIST_MISMATCH');
    process.stdout.write('READY:' + pid + '\n');
    await waitForParentGo();
    resultState = 'success'; resultCode = 'PROTOCOL_ONLY';
  } catch (error) {
    resultCode = error instanceof PilotError ? error.code : 'MCP_PROTOCOL_EXCEPTION';
    resultState = 'blocked';
  } finally {
    try {
      if (client) await client.close();
      else if (transport) await transport.close();
    } catch { resultState = 'unknown'; resultCode = 'MCP_CLOSE_FAILED'; }
    if (pid) {
      try {
        if (!(await waitGone(pid))) { resultState = 'unknown'; resultCode = 'SERVER_NOT_SETTLED'; }
      } catch { resultState = 'unknown'; resultCode = 'SERVER_EXIT_UNKNOWN'; }
    }
    process.stdin.destroy();
    output(resultState, resultCode);
    if (resultState !== 'success') process.exitCode = 2;
  }
}
const entry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (entry) {
  protocolOnly(process.argv.slice(2)).catch(() => {
    output('unknown', 'PROTOCOL_TOP_LEVEL_FAILURE');
    process.exitCode = 2;
  });
}
