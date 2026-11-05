// M3-P7 investigation-only Sbroenne single-file MCP metadata test.
// ZERO UIA, tools/call, screenshot or desktop operation. Native V3 host creates
// the private extraction directory and owns the Job before resuming Node.
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const research = path.join(repo, 'investigations', 'windows-desktop-automation');
const temp = path.join(research, 'temp');
const publish = path.join(temp, 'sbroenne-singlefile-publish');
const executable = path.join(publish, 'Sbroenne.WindowsMcp.exe');
const expectedSha = 'ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128';
const expectedSize = 59893792;

class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new PilotError(code); }
function output(state, code) {
  if (!/^(success|blocked|unknown)$/.test(state) || !/^[A-Z][A-Z0-9_]{2,63}$/.test(code))
    fail('INVALID_RESULT_CODE');
  process.stdout.write('RESULT:' + state + ':' + code + ':none\n');
}
function verifyArguments(args) {
  const [mode, manifest, sampleId] = args;
  if (args.length !== 3 || mode !== 'protocol' || manifest !== '-' ||
      typeof sampleId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(sampleId)) fail('INVALID_ARGUMENTS');
  return sampleId;
}
async function verifyNoReparseDir(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail('UNTRUSTED_DIRECTORY');
}
async function verifyPrivateExtractionRoot(sampleId) {
  // Native host freshly creates this path under an explicit owner-only Windows
  // DACL, before any child is resumed. Node verifies the exact name/emptiness.
  const extractionBase = path.join(temp, 'sbroenne-v3-extract-' + sampleId);
  for (const directory of [repo, research, temp, extractionBase])
    await verifyNoReparseDir(directory);
  if ((await fs.readdir(extractionBase)).length !== 0) fail('EXTRACTION_ROOT_NOT_EMPTY');
  return extractionBase;
}
async function verifyPinned() {
  await verifyNoReparseDir(publish);
  const names = await fs.readdir(publish);
  if (names.length !== 1 || names[0] !== 'Sbroenne.WindowsMcp.exe')
    fail('SINGLE_FILE_INVENTORY_MISMATCH');
  const stat = await fs.lstat(executable);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== expectedSize)
    fail('SINGLE_FILE_UNTRUSTED');
  if (createHash('sha256').update(await fs.readFile(executable)).digest('hex') !== expectedSha)
    fail('SINGLE_FILE_HASH_MISMATCH');
}
function verifiedWindowsEnv(extractionBase) {
  // No spread of Node's inherited environment: do not leak parent credentials,
  // PATH, temp, HOME or unrelated Workbridge configuration to MCP child.
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (typeof systemRoot !== 'string' || !/^C:\\Windows$/i.test(systemRoot))
    fail('SYSTEM_ROOT_UNVERIFIED');
  return Object.freeze({
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: extractionBase,
    MCP_WINDOWS_TIMEOUT_MS: '10000'
  });
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
  const sampleId = verifyArguments(args);
  await verifyPinned();
  const extractionBase = await verifyPrivateExtractionRoot(sampleId);
  const childEnv = verifiedWindowsEnv(extractionBase);
  let client, transport, pid;
  let resultState = 'unknown', resultCode = 'MCP_PROTOCOL_UNKNOWN';
  try {
    transport = new StdioClientTransport({
      command: executable,
      args: ['--tools', 'ui_snapshot'], cwd: repo,
      env: childEnv, stderr: 'pipe', maxBufferSize: 300000
    });
    transport.stderr?.on('data', () => {}); // Private provider stderr discarded.
    client = new Client({ name: 'workbridge-sbroenne-v3-protocol-only', version: '1.0.0' },
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
