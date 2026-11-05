#!/usr/bin/env node
// One disposable self-owned FlaUI WinForms click. Never targets RIFT or arbitrary windows.
// WARNING: execute-once changes desktop focus; use ONLY after explicit operator approval.
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { open, lstat, stat, realpath, readdir, readFile, unlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify, parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { withDesktopAdmission } from '../../../../scripts/desktop-turn-admission.mjs';

const execFileAsync = promisify(execFile);
const PROJECT = fileURLToPath(new URL('../../../../', import.meta.url));
const EVIDENCE = path.join(PROJECT, '.tools', 'desktop-evidence');
const DLL = path.join(PROJECT, '.tools', 'flaui-dummy-artifacts', 'bin',
  'FlaUIDummyClick', 'release', 'FlaUIDummyClick.dll');
const SOURCE = fileURLToPath(new URL('./Program.cs', import.meta.url));
const PROJECT_FILE = fileURLToPath(new URL('./FlaUIDummyClick.csproj', import.meta.url));
const DOTNET = 'C:\\Program Files\\dotnet\\dotnet.exe';
const CONFIRMATION = 'one-disposable-flaui-click';
const SINGLETON = 'flaui-dummy-singleton.intent.json';
const EXACT_ARGS = Object.freeze([DLL, '--dummy-live-once', '--confirm', 'disposable-window-only']);

export class DummyClickError extends Error {
  constructor(code, message) { super(message); this.name = 'DummyClickError'; this.code = code; }
}
function refuse(code, message) { throw new DummyClickError(code, message); }
function sha(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const shaPattern = /^[a-f0-9]{64}$/i;

export function parseDummyRequest(argv) {
  const seen = new Set();
  for (const token of argv) {
    if (!token.startsWith('--')) continue;
    const key = token.split('=')[0];
    if (seen.has(key)) refuse('INVALID_ARGUMENTS', 'Duplicate option');
    seen.add(key);
  }
  let v;
  try {
    ({ values: v } = parseArgs({
      args: argv, strict: true, allowPositionals: false,
      options: {
        'request-id': { type: 'string' }, 'dll-sha256': { type: 'string' },
        confirm: { type: 'string' }, 'preflight-only': { type: 'boolean' },
        'execute-once': { type: 'boolean' },
      },
    }));
  } catch { refuse('INVALID_ARGUMENTS', 'Only fixed dummy one-shot options are supported'); }
  if (!idPattern.test(v['request-id'] ?? '')) refuse('INVALID_REQUEST_ID', 'New bounded request ID required');
  if (!shaPattern.test(v['dll-sha256'] ?? '')) refuse('INVALID_DLL_HASH', 'Expected DLL SHA-256 required');
  if (v.confirm !== CONFIRMATION) refuse('CONFIRMATION_REQUIRED', 'Dummy-only explicit confirmation required');
  if (Number(v['preflight-only'] === true) + Number(v['execute-once'] === true) !== 1) {
    refuse('MODE_REQUIRED', 'Exactly one of preflight-only or execute-once is required');
  }
  return Object.freeze({
    requestId: v['request-id'], dllSha256: v['dll-sha256'].toLowerCase(),
    preflightOnly: v['preflight-only'] === true, executeOnce: v['execute-once'] === true,
  });
}

async function regularFile(file, min = 1, max = 64 * 1024 * 1024) {
  const s = await lstat(file).catch(() => null);
  if (!s?.isFile() || s.isSymbolicLink() || s.size < min || s.size > max ||
      (await realpath(file)).toLowerCase() !== path.resolve(file).toLowerCase()) {
    refuse('FILE_IDENTITY_INVALID', 'Required fixed file is missing, linked or outside bounds');
  }
  return s;
}

export async function verifyFixedBuild(request, {
  dll = DLL, source = SOURCE, projectFile = PROJECT_FILE,
} = {}) {
  if (!shaPattern.test(request?.dllSha256 ?? '')) refuse('INVALID_DLL_HASH', 'Explicit pinned build hash required');
  const [target, sourceStat, projectStat] = await Promise.all([
    regularFile(dll, 10000), stat(source), stat(projectFile),
  ]);
  if (target.mtimeMs + 1500 < Math.max(sourceStat.mtimeMs, projectStat.mtimeMs)) {
    refuse('STALE_BUILD', 'Rebuild the disposable helper after the last source edit');
  }
  const actual = sha(await readFile(dll));
  if (actual !== request.dllSha256.toLowerCase()) {
    refuse('DLL_HASH_CHANGED', 'Dummy DLL changed from the exact independently observed SHA-256');
  }
  return Object.freeze({ dll, sizeBytes: target.size, sha256: actual, mtimeMs: target.mtimeMs });
}

export async function inspectOwnSession(pid = process.pid) {
  if (!Number.isInteger(pid) || pid < 1 || pid > 0x7fffffff) refuse('SESSION_UNAVAILABLE', 'Invalid wrapper PID');
  const script = "$ErrorActionPreference='Stop'; $p=Get-Process -Id " + pid +
    " -ErrorAction Stop; [pscustomobject]@{pid=$p.Id;sessionId=$p.SessionId;startUtc=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress";
  let stdout;
  try {
    ({ stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command', script,
    ], { timeout: 10000, maxBuffer: 8192, windowsHide: true }));
  } catch { refuse('SESSION_UNAVAILABLE', 'Could not verify interactive Windows wrapper session'); }
  let info;
  try { info = JSON.parse(stdout); } catch { refuse('SESSION_UNAVAILABLE', 'Invalid Windows process proof'); }
  if (info?.pid !== pid || !Number.isInteger(info?.sessionId) || info.sessionId < 1 ||
      !Number.isFinite(Date.parse(info.startUtc ?? ''))) {
    refuse('SESSION_UNAVAILABLE', 'Not a proven interactive Windows session');
  }
  return Object.freeze({ pid: info.pid, sessionId: info.sessionId, startUtc: info.startUtc });
}

async function quarantineVeto(root) {
  const names = await readdir(root);
  if (names.some(n => n.startsWith('desktop-turn-quarantine-') && n.endsWith('.json'))) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Existing GUI quarantine forbids new input');
  }
}
async function exclusiveJson(file, value) {
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  if (bytes.length > 4096) refuse('JOURNAL_TOO_LARGE', 'Bounded record exceeded 4 KiB');
  let h;
  try { h = await open(file, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('ACTION_RECOVERY_REQUIRED', 'Prior dummy one-shot marker exists');
    throw e;
  }
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  return { bytes, sha256: sha(bytes) };
}
async function readBoundedJson(file) {
  const s = await lstat(file).catch(() => null);
  if (s === null) return null;
  if (!s.isFile() || s.isSymbolicLink() || s.size < 10 || s.size > 4096) {
    refuse('ACTION_RECOVERY_REQUIRED', 'Existing marker cannot be safely read');
  }
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch { refuse('ACTION_RECOVERY_REQUIRED', 'Existing marker is invalid JSON'); }
}
async function createOwnedTurn(root, request, session) {
  const filename = path.join(root, 'desktop-input-turn.lock');
  const stamp = {
    schemaVersion: 1, kind: 'workbridge.gui-turn',
    leaseId: randomUUID(), producer: 'flaui-dummy-click',
    requestId: request.requestId,
    owner: { pid: process.pid, sessionId: session.sessionId, processStartUtc: session.startUtc },
    target: { kind: 'self-owned-disposable-window' },
    acquiredUtc: new Date().toISOString(),
  };
  const bytes = Buffer.from(JSON.stringify(stamp) + '\n');
  let h;
  try { h = await open(filename, 'wx', 0o600); }
  catch (e) {
    if (e?.code === 'EEXIST') refuse('UI_TURN_BUSY', 'Desktop input turn owned or retained');
    throw e;
  }
  const original = await h.stat();
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
  return { filename, original, leaseId: stamp.leaseId, journal: { bytes, sha256: sha(bytes) } };
}
async function releaseOwnedTurn(turn) {
  const [a, bytes, b] = await Promise.all([
    lstat(turn.filename), readFile(turn.filename), lstat(turn.filename),
  ]);
  if (!a.isFile() || a.isSymbolicLink() || a.nlink !== 1 ||
      a.dev !== turn.original.dev || a.ino !== turn.original.ino ||
      b.dev !== a.dev || b.ino !== a.ino || a.size !== turn.journal.bytes.length ||
      b.size !== a.size || a.mtimeMs !== b.mtimeMs || a.ctimeMs !== b.ctimeMs ||
      sha(bytes) !== turn.journal.sha256) {
    refuse('UI_TURN_RECOVERY_REQUIRED', 'Desktop owner stamp changed; retain lock');
  }
  await unlink(turn.filename);
}

// Only a settled exit code 4 with the native helper's exact counter-zero response
// proves the child aborted BEFORE attempting a mouse event. A timeout, signal,
// missing counter or any other return remains ambiguous and is quarantined.
export function classifyProvenNoInput(error) {
  if (error?.killed === true || error?.signal != null || Number(error?.code) !== 4 ||
      typeof error?.stdout !== 'string' || error.stdout.length > 4096) return null;
  let data;
  try { data = JSON.parse(error.stdout.trim()); } catch { return null; }
  if (data?.ok !== false || data?.mode !== 'dummy-live-once' ||
      data?.count !== 0 || data?.inputAttempted !== false ||
      data?.code !== 'DUMMY_EVIDENCE_FAILED') return null;
  return Object.freeze({ submitted: false, count: 0,
    nativeProof: true, noInputVerified: true });
}

export async function sendFixedDummy({ dll = DLL, dotnet = DOTNET } = {}) {
  await regularFile(dotnet, 10000, 128 * 1024 * 1024);
  const args = [dll, '--dummy-live-once', '--confirm', 'disposable-window-only'];
  if (dll !== DLL || dotnet !== DOTNET || args.some((x, i) => x !== EXACT_ARGS[i])) {
    refuse('WRONG_INPUT_TARGET', 'Only the fixed disposable helper is permitted');
  }
  let stdout;
  try {
    ({ stdout } = await execFileAsync(dotnet, args, {
      cwd: PROJECT, timeout: 20000, maxBuffer: 16384, windowsHide: false,
    }));
  } catch (error) {
    const noInput = classifyProvenNoInput(error);
    if (noInput) return noInput;
    refuse('ACTION_RECOVERY_REQUIRED', 'Disposable native click process failed, timed out, or lacks no-input proof');
  }
  let data;
  try { data = JSON.parse(stdout.trim()); }
  catch { refuse('ACTION_RECOVERY_REQUIRED', 'Native counter proof missing/invalid'); }
  if (data?.ok !== true || data?.mode !== 'dummy-live-once' ||
      data?.count !== 1 || data?.inputAttempted !== true ||
      data?.target !== 'self-owned disposable button') {
    refuse('ACTION_RECOVERY_REQUIRED', 'Native dummy button did not prove exactly one click');
  }
  return Object.freeze({ submitted: true, count: 1, nativeProof: true });
}

export async function executeDummyOnce(request, {
  root = EVIDENCE,
  verifyDll = verifyFixedBuild,
  getSession = inspectOwnSession,
  sender = sendFixedDummy,
} = {}) {
  if (request?.executeOnce !== true || !idPattern.test(request.requestId ?? '')) {
    refuse('MODE_REQUIRED', 'Explicit one-shot dummy request required');
  }
  await mkdir(root, { recursive: true });
  const lockPath = path.join(root, 'desktop-input-turn.lock');
  return withDesktopAdmission(lockPath,
    { producer: 'flaui-dummy-click', requestId: request.requestId },
    async () => {
      await quarantineVeto(root);
      const intentPath = path.join(root, SINGLETON);
      const existing = await readBoundedJson(intentPath);
      if (existing) {
        if (existing.requestId !== request.requestId) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Disposable one-shot already attempted; new ID forbidden');
        }
        const oldReceipt = await readBoundedJson(path.join(root,
          'flaui-dummy-' + request.requestId + '.receipt.json'));
        if (oldReceipt?.requestId !== request.requestId ||
            !(oldReceipt.nativeCount === 1 && oldReceipt.submitted === true ||
              oldReceipt.nativeCount === 0 && oldReceipt.noInputVerified === true &&
              oldReceipt.submitted === false)) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Prior dummy outcome unresolved; no replay');
        }
        if (oldReceipt.nativeCount === 0) {
          return { ok: false, replayed: true, submitted: false, verified: true,
            status: 'PREVIOUS_DUMMY_NO_INPUT_DO_NOT_REPEAT', count: 0 };
        }
        return { ok: true, replayed: true, submitted: false,
          status: 'PREVIOUS_DUMMY_VERIFIED_DO_NOT_REPEAT', count: 1 };
      }
      const session = await getSession();
      const build = await verifyDll(request);
      const turn = await createOwnedTurn(root, request, session);
      let intentCreated = false;
      let intentSha256 = null;
      try {
        await quarantineVeto(root);
        const latestSession = await getSession();
        if (latestSession.pid !== session.pid ||
            latestSession.sessionId !== session.sessionId ||
            Date.parse(latestSession.startUtc) !== Date.parse(session.startUtc)) {
          refuse('SESSION_CHANGED', 'Desktop wrapper session changed');
        }
        const latestBuild = await verifyDll(request);
        if (latestBuild.sha256 !== build.sha256 || latestBuild.sizeBytes !== build.sizeBytes) {
          refuse('DLL_HASH_CHANGED', 'Disposable DLL changed before input admission');
        }
        const intent = {
          schemaVersion: 1, kind: 'workbridge.flaui-dummy-click-intent',
          requestId: request.requestId, action: 'one-self-owned-winforms-button-click',
          dllSha256: build.sha256, dllSizeBytes: build.sizeBytes,
          parentPid: session.pid, parentSessionId: session.sessionId,
          startedUtc: new Date().toISOString(),
        };
        const saved = await exclusiveJson(intentPath, intent);
        intentCreated = true;
        intentSha256 = saved.sha256;
        // The sender can only launch fixed dotnet/DLL arguments, never arbitrary RIFT input.
        const result = await sender();
        if (result?.submitted === false && result.count === 0 &&
            result.nativeProof === true && result.noInputVerified === true) {
          await exclusiveJson(path.join(root, 'flaui-dummy-' + request.requestId + '.receipt.json'), {
            schemaVersion: 1, kind: 'workbridge.flaui-dummy-no-input-receipt',
            requestId: request.requestId, completedUtc: new Date().toISOString(),
            nativeCount: 0, submitted: false, noInputVerified: true, dllSha256: build.sha256,
          });
          await releaseOwnedTurn(turn);
          return { ok: false, replayed: false, submitted: false, verified: true,
            status: 'NATIVE_DUMMY_NO_INPUT_ABORTED', count: 0 };
        }
        if (result?.submitted !== true || result.count !== 1 || result.nativeProof !== true) {
          refuse('ACTION_RECOVERY_REQUIRED', 'Native dummy result was uncertain');
        }
        await exclusiveJson(path.join(root, 'flaui-dummy-' + request.requestId + '.receipt.json'), {
          schemaVersion: 1, kind: 'workbridge.flaui-dummy-click-receipt',
          requestId: request.requestId, completedUtc: new Date().toISOString(),
          nativeCount: 1, submitted: true, dllSha256: build.sha256,
        });
        await releaseOwnedTurn(turn);
        return { ok: true, replayed: false, submitted: true, verified: true,
          status: 'NATIVE_DUMMY_BUTTON_CLICK_COUNT_ONE', count: 1 };
      } catch (error) {
        if (intentCreated) {
          try {
            await exclusiveJson(path.join(root,
              'desktop-turn-quarantine-' + turn.leaseId + '.json'), {
              schemaVersion: 1, kind: 'workbridge.gui-turn-quarantine',
              leaseId: turn.leaseId, requestId: request.requestId,
              ownerStampSha256: turn.journal.sha256, intentSha256,
              reasonCode: 'DUMMY_ACTION_RECOVERY_REQUIRED',
              processTreeSettlement: 'unknown', automaticRetryAllowed: false,
              createdUtc: new Date().toISOString(),
            });
          } catch {
            refuse('ACTION_RECOVERY_REQUIRED', 'Could not seal quarantine; GUI lock retained');
          }
        } else {
          await releaseOwnedTurn(turn);
        }
        throw error;
      }
    });
}

async function main() {
  let inputMayHaveStarted = false;
  try {
    const req = parseDummyRequest(process.argv.slice(2));
    if (req.preflightOnly) {
      const [build, session] = await Promise.all([verifyFixedBuild(req), inspectOwnSession()]);
      console.log(JSON.stringify({ ok: true, readOnly: true, status: 'PREFLIGHT_ONLY',
        dllSha256: build.sha256, dllSizeBytes: build.sizeBytes,
        parentSessionId: session.sessionId, inputAttempted: false }));
      return;
    }
    inputMayHaveStarted = true;
    const result = await executeDummyOnce(req);
    console.log(JSON.stringify(result));
    if (result.ok !== true) process.exitCode = 4;
  } catch (error) {
    console.log(JSON.stringify({ ok: false, code: error?.code ?? 'DUMMY_OPERATION_FAILED',
      message: error?.message ?? 'Unknown failure',
      inputAttempted: inputMayHaveStarted ? 'UNKNOWN_CHECK_INTENT' : false }));
    process.exitCode = 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
