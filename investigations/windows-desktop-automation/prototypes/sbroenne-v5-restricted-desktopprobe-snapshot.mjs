// M3-P11 FUTURE-ONLY: one read-only ui_snapshot of the owned disposable DesktopProbe.
// No live/UIA authorization. Compile-gated native V5 supervisor; exact lease/native oracle/Job0.
// Never run standalone or against RIFT/VM.
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const run = promisify(execFile);
const repo = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const investigation = path.join(repo, 'investigations', 'windows-desktop-automation');
const privateRoot = path.join(investigation, 'temp');
const serverDir = path.join(privateRoot, 'sbroenne-singlefile-publish');
const oracleScript = path.join(investigation, 'prototypes', 'Observe-DesktopProbeAndWatchdog-V5.ps1');
const leasePath = path.join(repo, '.tools', 'desktop-evidence', 'desktop-input-turn.lock');
const pinned = Object.freeze({
  'Sbroenne.WindowsMcp.exe': 'ce18a73e6bdf5d82df8880c36de245936a698ff1a4ba50fbb759163819343128'
});
const SERVER_SIZE = 59893792;
const NODE_EXE = String.raw`C:\Program Files\nodejs\node.exe`;
const NODE_SHA = '119d6fa70e6ae1b15b90688ab6bcc8e3a2819acea021af196895cab1843645af';
const ORACLE_SHA = '50ed06c93a64dd79c2e6e2ba1a1fb614dade642e2328979dc700f4923bb0228b';
const WATCHDOG_EXE = path.join(privateRoot, 'desktopprobe-watchdog-publish', 'DesktopProbeWatchdog.exe');
const WATCHDOG_SHA = '8edeae6c1633805290a5d761415fe3774e349cd57c357885abf6a3a506b79d66';
const NATIVE_POWERSHELL = String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`;
const KEYS = Object.freeze([
  'PATH', 'SYSTEMROOT', 'TEMP', 'WINDIR', 'DOTNET_BUNDLE_EXTRACT_BASE_DIR', 'MCP_WINDOWS_TIMEOUT_MS',
  'APPDATA', 'COMSPEC', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'PATHEXT',
  'PROCESSOR_ARCHITECTURE', 'PROGRAMDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)',
  'PROGRAMW6432', 'SYSTEMDRIVE', 'USERNAME', 'USERPROFILE'
]);
const EXPECTED_MASK = '111111' + '0'.repeat(14);
const TITLE = 'Workbridge GUI-004 Native Input Probe';
const MAX_RECEIPT = 6000;

export class PilotError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function fail(code) { throw new PilotError(code); }
function safeInt(x, max = 2147483647) {
  return Number.isSafeInteger(x) && x > 0 && x <= max;
}
function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function boundedDecimal(x, len = 19) {
  return typeof x === 'string' && /^[1-9][0-9]*$/.test(x) && x.length <= len &&
    BigInt(x) <= 9223372036854775807n;
}
function isChild(child, parent) {
  const relative = path.relative(parent, child);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) &&
    !path.isAbsolute(relative);
}
function absLocal(file) {
  return typeof file === 'string' && path.isAbsolute(file) &&
    !file.startsWith('\\\\') && !file.startsWith('//');
}
function requestIdValid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(value);
}
export function receiptName(sampleId) {
  if (!requestIdValid(sampleId)) fail('INVALID_SAMPLE_ID');
  return 'sbroenne-' + sampleId + '.jsonl';
}
function processAgeMs(ticks) {
  const now = BigInt(Date.now()) * 10000n + 621355968000000000n;
  const age = now - BigInt(ticks);
  return age < 0n ? -1 : Number(age / 10000n);
}

export function validateManifest(m, requestId, manifestPath) {
  if (!m || typeof m !== 'object' || m.schemaVersion !== 1 ||
      !requestIdValid(requestId) || m.requestId !== requestId ||
      !requestIdValid(m.runId) || !requestIdValid(m.leaseId) ||
      !safeInt(m.pid) || !safeInt(m.sessionId) ||
      !safeInt(m.watchdogPid) || m.jobActiveAfterSpawn !== 2 ||
      !boundedDecimal(m.hwnd) || !boundedDecimal(m.foregroundHwnd) ||
      !boundedDecimal(m.startedAtUtcTicks) || !boundedDecimal(m.watchdogStartedAtUtcTicks) ||
      !/^S-[0-9]+-[0-9]+(-[0-9]+)+$/.test(m.ownerSid ?? '') ||
      typeof m.className !== 'string' || !/^WindowsForms10\.Window\./.test(m.className) ||
      m.className.length > 220 || m.title !== TITLE ||
      !/^[a-fA-F0-9]{64}$/.test(m.exeSha256 ?? '') ||
      !absLocal(m.exePath) || path.basename(m.exePath).toLowerCase() !== 'desktopprobe.exe' ||
      !absLocal(m.evidenceDir)) fail('INVALID_TARGET_MANIFEST');
  if (!Number.isFinite(Date.parse(m.observedAtUtc)) || !Number.isFinite(Date.parse(m.deadlineUtc)) ||
      Date.now() - Date.parse(m.observedAtUtc) > 65000 ||
      Date.parse(m.observedAtUtc) > Date.now() + 1000 ||
      processAgeMs(m.startedAtUtcTicks) < 0 ||
      processAgeMs(m.startedAtUtcTicks) > 65000 ||
      Date.parse(m.deadlineUtc) - Date.now() < 30000)
    fail('MANIFEST_NOT_FRESH');
  const expectedEvidence = path.join(privateRoot, 'desktopprobe-' + m.runId, 'evidence');
  if (path.resolve(m.evidenceDir).toLowerCase() !== expectedEvidence.toLowerCase() ||
      path.resolve(manifestPath).toLowerCase() !== path.join(expectedEvidence, 'target-manifest.json').toLowerCase())
    fail('MANIFEST_PATH_MISMATCH');
  const expectedProbe = path.join(privateRoot, 'desktopprobe-' + m.runId, 'publish', 'DesktopProbe.exe');
  if (path.resolve(m.exePath).toLowerCase() !== expectedProbe.toLowerCase())
    fail('PROBE_EXE_NOT_WATCHDOG_PUBLISH');
  return Object.freeze({ ...m, exeSha256: m.exeSha256.toLowerCase() });
}

export function validateLease(lock, m) {
  if (!lock || lock.schemaVersion !== 1 || lock.kind !== 'workbridge.gui-turn' ||
      lock.producer !== 'desktopprobe-watchdog' ||
      lock.runId !== m.runId || lock.requestId !== m.requestId ||
      lock.leaseId !== m.leaseId || !lock.owner ||
      lock.owner.pid !== m.watchdogPid ||
      lock.owner.processStartUtcTicks !== m.watchdogStartedAtUtcTicks ||
      lock.owner.sessionId !== m.sessionId ||
      lock.target?.kind !== 'window' || lock.target?.pid !== null ||
      lock.target?.hwnd !== null || lock.target?.process !== 'DesktopProbe') {
    fail('FOREIGN_OR_MISSING_GUI_LEASE');
  }
  return true;
}

export function structuralTree(tree) {
  if (!Array.isArray(tree) || tree.length < 1 || tree.length > 100) fail('TREE_INVALID');
  let nodes = 0;
  let maxDepth = 0;
  function walk(item, depth) {
    if (!item || typeof item !== 'object' || typeof item.type !== 'string' ||
        !/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(item.type) || depth > 2)
      fail('TREE_INVALID');
    nodes++;
    if (nodes > 2048) fail('TREE_TOO_LARGE');
    maxDepth = Math.max(maxDepth, depth);
    const children = item.children ?? [];
    if (!Array.isArray(children) || children.length > 1024) fail('TREE_INVALID');
    return [item.type, children.map((child) => walk(child, depth + 1))];
  }
  const shape = tree.map((item) => walk(item, 0));
  return { nodes, maxDepth, structuralSha256: hash(JSON.stringify(shape)) };
}
export function projectSnapshot(result) {
  if (!result || result.isError === true || !Array.isArray(result.content)) fail('MCP_SNAPSHOT_ERROR');
  const blocks = result.content.filter((b) => b?.type === 'text');
  if (blocks.length !== 1 || typeof blocks[0].text !== 'string') fail('MCP_CONTENT_INVALID');
  const bytes = Buffer.byteLength(blocks[0].text, 'utf8');
  if (bytes < 10 || bytes > 262144) fail('MCP_OUTPUT_LIMIT');
  let raw;
  try { raw = JSON.parse(blocks[0].text); } catch { fail('MCP_JSON_INVALID'); }
  if (raw?.success !== true || raw.action !== 'get_tree' ||
      raw.kind !== 'full' || raw.snapshotIncomplete === true ||
      !Array.isArray(raw.tree))
    fail('MCP_SNAPSHOT_INCOMPLETE');
  const expected = new Map([['IncrementButton', 'Button'],
    ['ResetButton', 'Button'], ['CounterDisplay', 'Text']]);
  const counts = new Map([...expected].map(([id]) => [id, 0]));
  function discover(nodes) {
    for (const node of nodes) {
      if (expected.has(node?.automationId)) {
        if (node.type !== expected.get(node.automationId)) fail('FIXTURE_CONTROL_TYPE_MISMATCH');
        counts.set(node.automationId, counts.get(node.automationId) + 1);
      }
      if (Array.isArray(node.children)) discover(node.children);
    }
  }
  discover(raw.tree);
  if ([...counts.values()].some((count) => count !== 1)) fail('FIXTURE_CONTROLS_NOT_UNIQUE');
  return { ...structuralTree(raw.tree), fixtureControlCount: 3, fixtureControlsVerified: true, payloadBytes: bytes,
    incomplete: raw.snapshotIncomplete ?? null, kind: 'full' };
}

function envKeyMask(environment) {
  const names = new Set(Object.keys(environment).map(k => k.toUpperCase()));
  return KEYS.map(k => names.has(k) ? '1' : '0').join('');
}
async function verifyExactFile(filename, expectedSha, expectedSize = null) {
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      stat.size <= 0 || (expectedSize !== null && stat.size !== expectedSize))
    fail('PINNED_FILE_UNTRUSTED');
  if (hash(await fs.readFile(filename)) !== expectedSha)
    fail('PINNED_FILE_HASH_MISMATCH');
}
async function verifyFiles(sampleId) {
  if (envKeyMask(process.env) !== EXPECTED_MASK) fail('RESTRICTED_ENV_MASK_MISMATCH');
  const allowed = new Set(['PATH','SYSTEMROOT','WINDIR','TEMP','TMP',
    'DOTNET_BUNDLE_EXTRACT_BASE_DIR','MCP_WINDOWS_TIMEOUT_MS']);
  const actualKeys = Object.keys(process.env).map(k => k.toUpperCase());
  if (actualKeys.length !== allowed.size || new Set(actualKeys).size !== allowed.size ||
      actualKeys.some(k => !allowed.has(k)))
    fail('RESTRICTED_ENV_EXTRA_KEY');
  await verifyExactFile(NODE_EXE, NODE_SHA);
  await verifyExactFile(oracleScript, ORACLE_SHA);
  await verifyExactFile(WATCHDOG_EXE, WATCHDOG_SHA);
  const dirStat = await fs.lstat(serverDir);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink())
    fail('VENDOR_PUBLISH_DIRECTORY_UNTRUSTED');
  const names = await fs.readdir(serverDir);
  if (names.length !== 1 || names[0] !== 'Sbroenne.WindowsMcp.exe')
    fail('VENDOR_BINARY_INVENTORY_CHANGED');
  await verifyExactFile(path.join(serverDir, 'Sbroenne.WindowsMcp.exe'),
    pinned['Sbroenne.WindowsMcp.exe'], SERVER_SIZE);
  const extract = path.join(privateRoot, 'sbroenne-v5-extract-' + sampleId);
  const scratch = path.join(privateRoot, 'sbroenne-v5-scratch-' + sampleId);
  for (const folder of [privateRoot, extract, scratch]) {
    const st = await fs.lstat(folder);
    if (!st.isDirectory() || st.isSymbolicLink()) fail('PRIVATE_ROOT_UNTRUSTED');
  }
  if ((await fs.readdir(extract)).length || (await fs.readdir(scratch)).length)
    fail('PRIVATE_ROOT_NOT_EMPTY');
  if (path.resolve(process.env.DOTNET_BUNDLE_EXTRACT_BASE_DIR ?? '').toLowerCase() !==
        path.resolve(extract).toLowerCase() ||
      path.resolve(process.env.TEMP ?? '').toLowerCase() !== path.resolve(scratch).toLowerCase() ||
      path.resolve(process.env.TMP ?? '').toLowerCase() !== path.resolve(scratch).toLowerCase() ||
      process.env.MCP_WINDOWS_TIMEOUT_MS !== '10000')
    fail('PRIVATE_ENV_PATH_MISMATCH');
  return { extract, scratch };
}

async function verifyPathParents(m) {
  const run = path.join(privateRoot, 'desktopprobe-' + m.runId);
  const dirs = [path.parse(repo).root, path.dirname(repo), repo, investigation,
    privateRoot, run, m.evidenceDir, path.join(run, 'publish'),
    path.join(repo, '.tools'), path.dirname(leasePath),
    path.dirname(WATCHDOG_EXE)];
  for (const folder of dirs) {
    const st = await fs.lstat(folder);
    if (!st.isDirectory() || st.isSymbolicLink())
      fail('TARGET_OR_LEASE_PARENT_REPARSE');
  }
}

async function readBoundedJson(file, max = 8192) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > max)
    fail('UNTRUSTED_JSON_FILE');
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { fail('INVALID_JSON_FILE'); }
}
async function assertLease(m, minRemainingMs = 15000) {
  let lock;
  try { lock = await readBoundedJson(leasePath); }
  catch { fail('FOREIGN_OR_MISSING_GUI_LEASE'); }
  validateLease(lock, m);
  // PID existence is only supporting evidence; exact process-start identity is
  // committed in watchdog lease and manifest. Never steal/release this lease.
  try { process.kill(m.watchdogPid, 0); } catch { fail('WATCHDOG_NOT_ALIVE'); }
  if (Date.parse(m.deadlineUtc) - Date.now() < minRemainingMs) fail('WATCHDOG_DEADLINE_NEAR');
}

async function observe(m, approvedExeSha) {
  const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned',
    '-File', oracleScript, '-TargetPid', String(m.pid), '-TargetHwnd', m.hwnd,
    '-StartTicks', m.startedAtUtcTicks, '-TargetSession', String(m.sessionId),
    '-ExePath', m.exePath, '-ExeSha256', approvedExeSha, '-ClassName', m.className,
    '-ForegroundHwnd', m.foregroundHwnd, '-EvidenceDir', m.evidenceDir,
    '-OwnerSid', m.ownerSid, '-WatchdogPid', String(m.watchdogPid),
    '-WatchdogStartTicks', m.watchdogStartedAtUtcTicks,
    '-WatchdogExeSha256', WATCHDOG_SHA];
  let stdout;
  try {
    ({ stdout } = await run(NATIVE_POWERSHELL, args, {
      windowsHide: true, shell: false, timeout: 12000, maxBuffer: 32768,
      encoding: 'utf8'
    }));
  } catch { fail('NATIVE_OBSERVER_REJECTED'); }
  let native;
  try { native = JSON.parse(stdout.trim()); } catch { fail('NATIVE_ORACLE_JSON_INVALID'); }
  if (native?.schemaVersion !== 1 || native.verified !== true ||
      native.ownerSidVerified !== true || native.watchdogOwnerVerified !== true || native.pid !== m.pid ||
      native.startedAtUtcTicks !== m.startedAtUtcTicks ||
      native.sessionId !== m.sessionId || native.hwnd !== m.hwnd ||
      native.className !== m.className ||
      native.foregroundHwnd !== m.foregroundHwnd ||
      native.rootHwnd !== m.hwnd || native.ownerHwnd !== '0' ||
      native.windowStation !== 'WinSta0' || native.desktopName !== 'Default' ||
      !native.rect || !Number.isFinite(native.rect.width) ||
      native.rect.width < 300 || native.rect.height < 200 ||
      native.journal?.eventCount !== 2 || native.journal.shown !== true ||
      native.journal.counter !== 0 || native.journal.unexpectedInputEvents !== 0 ||
      !/^[a-f0-9]{64}$/.test(native.journal.sha256 ?? ''))
    fail('NATIVE_ORACLE_MISMATCH');
  return native;
}
function sameObservation(a, b) {
  return a.pid === b.pid && a.startedAtUtcTicks === b.startedAtUtcTicks &&
    a.sessionId === b.sessionId && a.hwnd === b.hwnd &&
    a.className === b.className && a.foregroundHwnd === b.foregroundHwnd &&
    JSON.stringify(a.rect) === JSON.stringify(b.rect) &&
    a.journal.sha256 === b.journal.sha256 && a.journal.counter === b.journal.counter &&
    a.journal.unexpectedInputEvents === b.journal.unexpectedInputEvents;
}
async function waitForParentGo() {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => finish(false), 8500);
    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.off('data', data);
      if (ok) resolve(); else reject(new PilotError('NATIVE_HOST_ACK_MISSING'));
    }
    function data(chunk) {
      const text = String(chunk);
      finish(text === 'GO\r\n' || text === 'GO\n');
    }
    process.stdin.once('data', data);
    process.stdin.resume();
  });
}
async function waitGone(pid) {
  for (let i = 0; i < 40; i++) {
    try { process.kill(pid, 0); }
    catch (error) { if (error?.code === 'ESRCH') return true; throw error; }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}
function publicCode(error, dispatchEntered) {
  if (error instanceof PilotError) return error.code;
  return dispatchEntered ? 'SNAPSHOT_UNKNOWN' : 'STATIC_PREFLIGHT_ERROR';
}
function output(state, code, sha = 'none') {
  if (!/^(success|blocked|unknown)$/.test(state) ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(code) ||
      (sha !== 'none' && !/^[a-f0-9]{64}$/.test(sha))) {
    state = 'unknown'; code = 'INVALID_RECEIPT'; sha = 'none';
  }
  process.stdout.write('RESULT:' + state + ':' + code + ':' + sha + '\n');
}

export async function main(argv) {
  const [mode, manifestArg, sampleId, approvedExeSha] = argv;
  if (argv.length !== 4 || mode !== 'snapshot' || !requestIdValid(sampleId) ||
      !/^[a-f0-9]{64}$/i.test(approvedExeSha ?? '') || !absLocal(manifestArg)) { output('blocked', 'INVALID_RUN_ARGUMENTS'); process.exitCode = 2; return; }

  let client, transport, audit;
  let serverPid;
  let dispatchEntered = false;
  let requestStarted = performance.now();
  let state = 'blocked';
  let code = 'PREFLIGHT_BLOCKED';
  let summary = null;
  let m = null;
  const latency = { pin: null, before: null, versionOrConnect: null,
    preDispatch: null, discoverOrSnapshot: null, inspect: null, after: null, close: null, total: null };
  try {
    const fullManifest = path.resolve(manifestArg);
    if (!isChild(fullManifest, privateRoot)) fail('UNTRUSTED_MANIFEST');
    const raw = await readBoundedJson(fullManifest);
    m = validateManifest(raw, raw?.requestId, fullManifest);
    if (m.exeSha256.toLowerCase() !== approvedExeSha.toLowerCase())
      fail('FIXTURE_COORDINATOR_SHA_MISMATCH');
    await verifyPathParents(m);
    await verifyExactFile(m.exePath, approvedExeSha.toLowerCase());
    // Stronger than A policy: three observers and an owned vendor Job must fit the fixture lifetime.
    if (Date.parse(m.deadlineUtc) - Date.now() < 80000) fail('B_SNAPSHOT_BUDGET_INSUFFICIENT');
    await assertLease(m);
    let mark = performance.now();
    const privateFolders = await verifyFiles(sampleId);
    latency.pin = Math.round(performance.now() - mark);
    mark = performance.now();
    const before = await observe(m, approvedExeSha.toLowerCase());
    latency.before = Math.round(performance.now() - mark);
    await assertLease(m);

    // Do not mark the attempt entered until exact process/window/lease checks pass.
    const receiptFile = path.join(m.evidenceDir, receiptName(sampleId));
    audit = await fs.open(receiptFile, 'wx', 0o600);
    await audit.write(JSON.stringify({
      schemaVersion: 1, stage: 'entered', provider: 'sbroenne-restricted-mcp-v5',
      runId: m.runId, requestId: m.requestId, sampleId, targetPid: m.pid, targetHwnd: m.hwnd,
      leaseId: m.leaseId, utc: new Date().toISOString()
    }) + '\n');
    // Must durably record entered BEFORE any actual UIA snapshot dispatch.
    await audit.sync();

    mark = performance.now();
    transport = new StdioClientTransport({
      command: path.join(serverDir, 'Sbroenne.WindowsMcp.exe'),
      args: ['--tools', 'ui_snapshot'], cwd: repo,
      env: { DOTNET_BUNDLE_EXTRACT_BASE_DIR: privateFolders.extract,
        MCP_WINDOWS_TIMEOUT_MS: '10000' }, stderr: 'pipe', maxBufferSize: 65536
    });
    transport.stderr?.on('data', () => {}); // Drain, never disclose raw diagnostics.
    client = new Client({ name: 'workbridge-sbroenne-restricted-v5-snapshot', version: '1.0.0' },
      { capabilities: {}, versionNegotiation: { mode: 'legacy' } });
    await client.connect(transport);
    serverPid = transport.pid;
    if (!safeInt(serverPid)) fail('SERVER_PID_INVALID');
    const catalog = await client.listTools();
    if (catalog?.tools?.length !== 1 || catalog.tools[0]?.name !== 'ui_snapshot')
      fail('SERVER_ALLOWLIST_MISMATCH');
    latency.versionOrConnect = Math.round(performance.now() - mark);

    // Stop here until Sbroenne-Provider-Host proves exact private Job membership.
    process.stdout.write('READY:' + serverPid + '\n');
    await waitForParentGo();
    await assertLease(m);
    mark = performance.now();
    const immediatelyBefore = await observe(m, approvedExeSha.toLowerCase()); // Third independent oracle, timed separately.
    if (!sameObservation(before, immediatelyBefore)) fail('PREDISPATCH_TARGET_DRIFT');
    latency.preDispatch = Math.round(performance.now() - mark);
    await assertLease(m, 40000);
    // Durable exact-target intent immediately before dispatch: a crash after this
    // line is UNKNOWN, never a reason to replay or assume no UIA call occurred.
    await audit.write(JSON.stringify({
      schemaVersion: 1, stage: 'dispatch-pending', readOnly: true,
      provider: 'sbroenne-restricted-mcp-v5', sampleId, requestId: m.requestId,
      targetPid: m.pid, targetHwnd: m.hwnd, utc: new Date().toISOString()
    }) + '\n');
    await audit.sync();
    dispatchEntered = true;
    mark = performance.now();
    const result = await client.callTool({
      name: 'ui_snapshot',
      arguments: { windowHandle: m.hwnd, maxDepth: 1, mode: 'full', includeDiagnostics: false }
    }, undefined, { timeout: 12000 });
    latency.discoverOrSnapshot = Math.round(performance.now() - mark);
    summary = projectSnapshot(result);
    mark = performance.now();
    const after = await observe(m, approvedExeSha.toLowerCase());
    latency.after = Math.round(performance.now() - mark);
    await assertLease(m);
    if (!sameObservation(before, after)) fail('TARGET_OR_FOREGROUND_DRIFT');
    state = 'success'; code = 'READONLY_SNAPSHOT_VERIFIED';
  } catch (error) {
    code = publicCode(error, dispatchEntered);
    state = dispatchEntered ? 'unknown' : 'blocked';
  } finally {
    const mark = performance.now();
    if (client) {
      try { await client.close(); }
      catch { state = 'unknown'; code = 'MCP_CLOSE_FAILED'; }
    } else if (transport) {
      try { await transport.close(); }
      catch { state = 'unknown'; code = 'MCP_CLOSE_FAILED'; }
    }
    latency.close = Math.round(performance.now() - mark);
    if (serverPid) {
      try {
        if (!(await waitGone(serverPid))) { state = 'unknown'; code = 'SERVER_NOT_SETTLED'; }
      } catch { state = 'unknown'; code = 'SERVER_EXIT_UNKNOWN'; }
    }
    latency.total = Math.round(performance.now() - requestStarted);
    let digest = 'none';
    if (audit) {
      const safe = {
        schemaVersion: 1, stage: 'finished', provider: 'sbroenne-restricted-mcp-v5',
        state, code, requestId: m?.requestId ?? null, sampleId, runId: m?.runId ?? null,
        backendVersion: 'v1.3.28+655b9fc92d03ad52a270067c6844ea1231c90559',
        sourceHash: pinned['Sbroenne.WindowsMcp.exe'],
        serverPid: serverPid ?? null, targetPid: m?.pid ?? null,
        latencyMs: latency, tree: summary,
        processTreeSettlement: 'native-host-required',
        utc: new Date().toISOString()
      };
      const json = JSON.stringify(safe);
      try {
        if (Buffer.byteLength(json, 'utf8') > MAX_RECEIPT) throw new Error();
        await audit.write(json + '\n');
        await audit.sync();
        await audit.close();
        const pathToReceipt = path.join(m.evidenceDir, receiptName(sampleId));
        digest = hash(await fs.readFile(pathToReceipt));
      } catch {
        state = 'unknown'; code = 'RECEIPT_WRITE_FAILED'; digest = 'none';
        try { await audit.close(); } catch {}
      }
    }
    output(state, code, digest);
    if (state !== 'success') process.exitCode = 2;
  }
}
const isEntry = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntry) {
  main(process.argv.slice(2)).catch(() => {
    output('unknown', 'TOP_LEVEL_FAILURE');
    process.exitCode = 2;
  });
}

