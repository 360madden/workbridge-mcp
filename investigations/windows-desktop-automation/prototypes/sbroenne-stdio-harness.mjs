// Investigation-only MCP stdio lifecycle probe. Does not call any UI tool.
// This is NOT a production Workbridge provider or general-purpose MCP launcher.
import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUBLISH = join(REPO, 'investigations', 'windows-desktop-automation', 'temp', 'sbroenne-stdio-publish');
const EXPECTED_EXE = join(PUBLISH, 'Sbroenne.WindowsMcp.exe');
const PINNED_FILES = Object.freeze({
  'Sbroenne.WindowsMcp.exe': 'c74dfc9e46ee8e4db765561aa8c4b2eb5c7b7ce22b33b1300fffd3f17e47f0f9',
  'Sbroenne.WindowsMcp.dll': '99d3a37d98452f9b1d2f0ee44664ebdd0a422fcdf9f56fc869cd6fa38b6a9900',
  'Sbroenne.WindowsMcp.runtimeconfig.json': '6df5b8a97420042ba676b33842afa9a19f9a4fbc2ab2c23fe5c80cec8c065e39',
});
const ONLY_TOOL = 'ui_snapshot';
const MAX_STDERR_BYTES = 256 * 1024;
const DEFAULT_DEADLINE_MS = 20_000;
const MAX_DEADLINE_MS = 60_000;

class ProbeFailure extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function parseArgs(argv) {
  let server;
  let timeoutMs = DEFAULT_DEADLINE_MS;
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!value || !['--server', '--timeout-ms'].includes(key)) {
      throw new ProbeFailure('INVALID_ARGUMENTS');
    }
    if (key === '--server' && !server) {
      server = value;
    } else if (key === '--timeout-ms' && /^\d+$/.test(value)) {
      timeoutMs = Number(value);
    } else {
      throw new ProbeFailure('INVALID_ARGUMENTS');
    }
  }
  if (!server || !Number.isSafeInteger(timeoutMs) || timeoutMs < 5_000 || timeoutMs > MAX_DEADLINE_MS) {
    throw new ProbeFailure('INVALID_ARGUMENTS');
  }
  return { server, timeoutMs };
}

function fileIdentity(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new ProbeFailure('ARTIFACT_NOT_REGULAR_FILE');
  return { size: stat.size, mtimeMs: stat.mtimeMs };
}

async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyPinnedArtifacts(explicitServer) {
  if (process.platform !== 'win32') throw new ProbeFailure('WINDOWS_REQUIRED');
  if (!resolve(explicitServer).toLowerCase().endsWith('sbroenne.windowsmcp.exe')) {
    throw new ProbeFailure('WRONG_BINARY');
  }
  const expected = realpathSync.native(EXPECTED_EXE);
  const actual = realpathSync.native(explicitServer);
  if (actual.toLowerCase() !== expected.toLowerCase()) throw new ProbeFailure('WRONG_BINARY_PATH');
  const repoReal = realpathSync.native(REPO);
  const publishReal = realpathSync.native(PUBLISH);
  const rel = relative(repoReal.toLowerCase(), publishReal.toLowerCase());
  if (rel.startsWith('..') || rel.includes('..' + sep) || resolve(repoReal, rel).toLowerCase() !== publishReal.toLowerCase()) {
    throw new ProbeFailure('PUBLISH_PATH_ESCAPES_REPO');
  }
  for (const [name, expectedHash] of Object.entries(PINNED_FILES)) {
    const file = join(PUBLISH, name);
    const before = fileIdentity(file);
    const observedHash = await sha256(file);
    const after = fileIdentity(file);
    if (observedHash !== expectedHash) throw new ProbeFailure('ARTIFACT_HASH_MISMATCH');
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
      throw new ProbeFailure('ARTIFACT_CHANGED_DURING_HASH');
    }
  }
  return expected;
}

function bounded(promise, timeoutMs, code) {
  if (timeoutMs <= 0) return Promise.reject(new ProbeFailure(code));
  let timer;
  const limit = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new ProbeFailure(code)), timeoutMs);
  });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

function oneLineReceipt(receipt) {
  process.stdout.write(JSON.stringify(receipt) + '\n');
}

async function main() {
  const start = performance.now();
  const receipt = {
    schemaVersion: 1,
    prototype: 'sbroenne-stdio-mcp-lifecycle',
    mode: 'tools-list-only',
    result: 'blocked',
    reasonCode: 'NOT_STARTED',
    sourceTag: 'v1.3.28',
    pinnedExeSha256: PINNED_FILES['Sbroenne.WindowsMcp.exe'],
    pinnedDllSha256: PINNED_FILES['Sbroenne.WindowsMcp.dll'],
    toolNames: [],
    toolCount: 0,
    actualToolCalls: 0,
    childPid: null,
    childProcessCloseObserved: false,
    ownedChildExited: false,
    processTreeSettlement: 'not-proven',
    stderrByteCount: 0,
    stderrClipped: false,
    runtimeMs: 0,
  };
  let transport;
  let client;
  let errorCode = null;
  let childAttempted = false;
  let closeResolve;
  const processClosed = new Promise((resolveClosed) => {
    closeResolve = resolveClosed;
  });
  let closeHookInstalled = false;
  const installCloseHook = () => {
    if (!transport || closeHookInstalled) return;
    closeHookInstalled = true;
    const original = transport.onclose;
    transport.onclose = (...args) => {
      receipt.childProcessCloseObserved = true;
      receipt.ownedChildExited = true;
      closeResolve();
      if (original) original(...args);
    };
  };

  try {
    const { server, timeoutMs } = parseArgs(process.argv.slice(2));
    const endAt = start + timeoutMs;
    const remaining = () => Math.max(1, Math.floor(endAt - performance.now()));
    const verifiedServer = await bounded(verifyPinnedArtifacts(server), remaining(), 'PIN_CHECK_DEADLINE');
    receipt.reasonCode = 'MCP_NOT_CONNECTED';
    transport = new StdioClientTransport({
      command: verifiedServer,
      args: ['--tools', ONLY_TOOL],
      cwd: PUBLISH,
      env: { WINDOWS_MCP_EXCLUDE_TOOLS: '' },
      stderr: 'pipe',
    });
    transport.stderr?.on('data', (chunk) => {
      receipt.stderrByteCount = Math.min(MAX_STDERR_BYTES, receipt.stderrByteCount + chunk.length);
      if (receipt.stderrByteCount === MAX_STDERR_BYTES) receipt.stderrClipped = true;
      // Intentionally discard stderr content; it can contain private UI details.
    });
    client = new Client(
      { name: 'workbridge-isolated-stdio-lifecycle-probe', version: '0.1.0' },
      { capabilities: {}, versionNegotiation: { mode: 'legacy' } },
    );
    childAttempted = true;
    await bounded(client.connect(transport), remaining(), 'MCP_CONNECT_DEADLINE');
    receipt.childPid = transport.pid;
    installCloseHook();
    const listed = await bounded(client.listTools(), remaining(), 'MCP_LIST_DEADLINE');
    const names = Array.isArray(listed?.tools) ? listed.tools.map((t) => t.name) : [];
    receipt.toolNames = names.slice(0, 8);
    receipt.toolCount = names.length;
    if (names.length !== 1 || names[0] !== ONLY_TOOL) {
      throw new ProbeFailure('ALLOWLIST_VIOLATION');
    }
    receipt.reasonCode = 'PROTOCOL_AND_ALLOWLIST_VERIFIED';
  } catch (error) {
    errorCode = error instanceof ProbeFailure ? error.code : 'PROBE_EXCEPTION';
    receipt.reasonCode = errorCode;
  } finally {
    if (transport) {
      receipt.childPid ??= transport.pid;
      installCloseHook();
      try {
        // SDK close uses EOF, TERM and eventually KILL, but its resolution alone
        // is NOT proof that the spawned process has exited.
        await bounded(client ? client.close() : transport.close(), 5_500, 'TRANSPORT_CLOSE_DEADLINE');
      } catch {
        if (!errorCode) errorCode = 'TRANSPORT_CLOSE_ERROR';
      }
      if (!receipt.childProcessCloseObserved) {
        try {
          await bounded(processClosed, 2_000, 'PROCESS_CLOSE_NOT_OBSERVED');
        } catch {
          if (!errorCode) errorCode = 'PROCESS_CLOSE_NOT_OBSERVED';
        }
      }
    }
  }

  if (childAttempted && !receipt.childProcessCloseObserved) {
    receipt.result = 'unknown_outcome';
    receipt.reasonCode = errorCode ?? 'PROCESS_CLOSE_NOT_OBSERVED';
  } else if (errorCode) {
    receipt.result = childAttempted ? 'protocol_failed' : 'blocked';
    receipt.reasonCode = errorCode;
  } else if (receipt.reasonCode === 'PROTOCOL_AND_ALLOWLIST_VERIFIED' && receipt.childProcessCloseObserved) {
    receipt.result = 'protocol_passed';
  } else {
    receipt.result = 'blocked';
  }
  // A child "close" event proves that specific process handle settled; it does
  // not prove Windows Job Object active-member count or all grandchildren gone.
  receipt.processTreeSettlement = childAttempted ? 'not-proven' : 'not-started';
  receipt.runtimeMs = Math.round(performance.now() - start);
  oneLineReceipt(receipt);
  process.exitCode = receipt.result === 'protocol_passed' ? 0
    : receipt.result === 'blocked' ? 2
    : receipt.result === 'protocol_failed' ? 3 : 4;
}

await main();